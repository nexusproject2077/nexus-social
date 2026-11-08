import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("entity_data", Path(__file__).resolve().parents[1] / "services" / "entity_data.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def statement(value):
    return {"rank": "normal", "mainsnak": {"snaktype": "value", "datavalue": {"value": value}}}

def wd_date(text, precision=11):
    return {"time": text, "precision": precision, "calendarmodel": "http://www.wikidata.org/entity/Q1985727"}

class EntityTests(unittest.TestCase):
    def test_birthday(self):
        e = {"id": "Q1", "claims": {"P569": [statement(wd_date("+2000-12-10T00:00:00Z"))]}}
        self.assertEqual(m.person_card(e, m.date(2026, 11, 8))["age"], 25)

    def test_imprecise(self):
        e = {"id": "Q1", "claims": {"P569": [statement(wd_date("+2000-01-01T00:00:00Z", 9))]}}
        self.assertIsNone(m.person_card(e)["age"])

    def test_deceased(self):
        e = {"id": "Q1", "claims": {"P569": [statement(wd_date("+1900-01-01T00:00:00Z"))], "P570": [statement(wd_date("+1980-01-01T00:00:00Z"))]}}
        self.assertEqual(m.person_card(e)["age"], 80)

    def test_height_conflict(self):
        e = {"id": "Q1", "claims": {"P2048": [statement({"amount": "+1.8", "unit": "http://www.wikidata.org/entity/Q11573"}), statement({"amount": "+190", "unit": "http://www.wikidata.org/entity/Q174728"})]}}
        self.assertIsNone(m.person_card(e)["height_m"])

    def test_pending_score(self):
        event = {"id": "1", "competitions": [{"competitors": [{"homeAway": "home", "team": {"id": "1"}}, {"homeAway": "away", "team": {"id": "2"}}], "status": {"type": {"state": "pre"}}}]}
        self.assertIsNone(m.normalize_match(event)["home"]["score"])

    def test_nested_score(self):
        e = {"competitions": [{"competitors": [{"homeAway": "home", "score": {"displayValue": "2"}, "team": {"id": "1"}}]}]}
        self.assertEqual(m.normalize_match(e)["home"]["score"], "2")

if __name__ == "__main__":
    unittest.main()
