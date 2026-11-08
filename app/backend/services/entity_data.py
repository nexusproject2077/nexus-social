import json
import time
import threading
from collections import OrderedDict
from datetime import date, datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

LEAGUES = ("fra.1", "eng.1", "esp.1", "ita.1", "ger.1", "por.1")
_CACHE = OrderedDict()
_LOCK = threading.Lock()

def fetch_json(url, ttl=300):
    now = time.monotonic()
    with _LOCK:
        cached = _CACHE.get(url)
        if cached and cached[0] > now:
            _CACHE.move_to_end(url)
            return cached[1]
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "NexusSocialEntitySearch/1.0"})
    with urlopen(request, timeout=8) as response:
        raw = response.read(4000001)
    if len(raw) > 4000000:
        raise ValueError("Upstream response too large")
    data = json.loads(raw)
    with _LOCK:
        _CACHE[url] = (now + ttl, data)
        _CACHE.move_to_end(url)
        while len(_CACHE) > 128:
            _CACHE.popitem(last=False)
    return data

def wiki(params):
    return fetch_json("https://www.wikidata.org/w/api.php?" + urlencode({"format": "json", **params}), 3600)

def claims(entity, prop):
    statements = [s for s in entity.get("claims", {}).get(prop, []) if s.get("rank") != "deprecated" and s.get("mainsnak", {}).get("snaktype") == "value"]
    preferred = [s for s in statements if s.get("rank") == "preferred"]
    return [s["mainsnak"].get("datavalue", {}).get("value") for s in (preferred or statements)]

def exact_date(entity, prop):
    values = claims(entity, prop)
    dates = set()
    for value in values:
        if not isinstance(value, dict) or value.get("precision", 0) < 11 or value.get("calendarmodel") != "http://www.wikidata.org/entity/Q1985727":
            return None
        try:
            dates.add(date.fromisoformat(value["time"].lstrip("+")[:10]))
        except (ValueError, KeyError):
            return None
    return next(iter(dates)) if len(dates) == 1 else None

def person_card(entity, today=None):
    today = today or datetime.now(timezone.utc).date()
    label = entity.get("labels", {}).get("fr") or entity.get("labels", {}).get("en") or {}
    description = entity.get("descriptions", {}).get("fr") or entity.get("descriptions", {}).get("en") or {}
    born = exact_date(entity, "P569")
    has_death = bool(entity.get("claims", {}).get("P570"))
    died = exact_date(entity, "P570") if has_death else None
    end = died if has_death else today
    age = None
    if born and end and born <= end <= today:
        age = end.year - born.year - ((end.month, end.day) < (born.month, born.day))
    heights = set()
    for value in claims(entity, "P2048"):
        if not isinstance(value, dict):
            continue
        factor = {"http://www.wikidata.org/entity/Q11573": 1, "http://www.wikidata.org/entity/Q174728": 0.01}.get(value.get("unit"))
        try:
            meters = float(value["amount"]) * factor if factor else None
            if meters is not None and 0 < meters < 3:
                heights.add(round(meters, 3))
        except (ValueError, TypeError, KeyError):
            pass
    qid = entity["id"]
    article = entity.get("sitelinks", {}).get("frwiki") or entity.get("sitelinks", {}).get("enwiki") or {}
    return {"id": "wikidata:" + qid, "kind": "person", "name": label.get("value", qid), "description": description.get("value", ""), "birth_date": born.isoformat() if born else None, "age": age, "age_at_death": has_death, "height_m": next(iter(heights)) if len(heights) == 1 else None, "source_url": "https://www.wikidata.org/wiki/" + qid, "article_url": article.get("url"), "data_license": "CC0", "retrieved_at": datetime.now(timezone.utc).isoformat()}

def search_people(query):
    matches = wiki({"action": "wbsearchentities", "search": query, "language": "fr", "uselang": "fr", "type": "item", "limit": 8}).get("search", [])
    ids = [m["id"] for m in matches if str(m.get("id", "")).startswith("Q")]
    if not ids:
        return []
    entities = wiki({"action": "wbgetentities", "ids": "|".join(ids), "props": "labels|descriptions|claims|sitelinks/urls", "languages": "fr|en", "sitefilter": "frwiki|enwiki"}).get("entities", {})
    return [person_card(entities[qid]) for qid in ids if qid in entities and any(isinstance(v, dict) and v.get("id") == "Q5" for v in claims(entities[qid], "P31"))]

def search_clubs(query, league):
    data = fetch_json(f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/teams?limit=1000", 3600)
    result = []
    q = query.casefold()
    for sport in data.get("sports", []):
        for competition in sport.get("leagues", []):
            for entry in competition.get("teams", []):
                team = entry.get("team", {})
                names = [team.get(k, "") for k in ("displayName", "shortDisplayName", "abbreviation")]
                if not any(q in str(n).casefold() for n in names):
                    continue
                tid = str(team.get("id", ""))
                if not tid.isdigit():
                    continue
                result.append({"id": f"espn:{league}:{tid}", "kind": "club", "team_id": tid, "league": league, "name": team.get("displayName", tid), "logo": next((x.get("href") for x in team.get("logos", []) if x.get("href")), None), "source": "ESPN"})
    return result[:20]

def normalize_match(event):
    competition = next(iter(event.get("competitions", [])), {})
    competitors = competition.get("competitors", [])
    home = next((c for c in competitors if c.get("homeAway") == "home"), {})
    away = next((c for c in competitors if c.get("homeAway") == "away"), {})
    status = competition.get("status") or event.get("status") or {}
    def side(item):
        score = item.get("score")
        return {"id": str(item.get("team", {}).get("id", "")), "name": item.get("team", {}).get("displayName", ""), "score": score.get("displayValue", score.get("value")) if isinstance(score, dict) else score}
    return {"id": str(event.get("id", "")), "date": competition.get("date") or event.get("date"), "home": side(home), "away": side(away), "state": status.get("type", {}).get("state"), "status": status.get("type", {}).get("description"), "clock": status.get("displayClock")}

def club_schedule(league, team_id, season):
    data = fetch_json(f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/teams/{team_id}/schedule?" + urlencode({"season": season}), 120)
    if not isinstance(data.get("events"), list):
        raise ValueError("Upstream schedule unavailable")
    matches = [normalize_match(e) for e in data["events"]]
    matches = [m for m in matches if team_id in (m["home"]["id"], m["away"]["id"])]
    return sorted(matches, key=lambda m: (m.get("date") or "", m["id"]))

def club_standings(league, season):
    url = f"https://site.web.api.espn.com/apis/v2/sports/soccer/{league}/standings?" + urlencode({"season": season})
    data = fetch_json(url, 300)
    groups = data.get("children") or [data]
    result = []
    for group in groups:
        rows = []
        for entry in group.get("standings", {}).get("entries", []):
            team = entry.get("team", {})
            stats = {s.get("name"): s.get("displayValue", s.get("value")) for s in entry.get("stats", [])}
            rows.append({"team_id": str(team.get("id", "")), "name": team.get("displayName"), "stats": stats})
        if rows:
            result.append({"name": group.get("name"), "entries": rows})
    return result
