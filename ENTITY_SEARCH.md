# Entity search: backend first increment

This increment does NOT change SearchPage.js or display cards in the frontend. It adds authenticated API routes, provider adapters, unit tests and a Docker entry point registering the router without rewriting server.py.

## Start and test

From app/backend: `uvicorn search_app:app`. Existing deployments starting `server:app` directly must explicitly switch to `search_app:app` to register these routes. The root Dockerfile now uses search_app:app. A git push may trigger existing deployment automation; no manual deployment command is included.

Run: `python -m unittest discover -s tests -p test_entity_data.py`. Tests cover local transformations, not live providers, MongoDB, authentication, Docker startup or browser integration.

## API

- GET /api/entity-search?q=Paris&kind=club&league=fra.1
- GET /api/entity-search?q=Nom&kind=person
- GET /api/entity-search/clubs/{league}/{team_id}/matches?season=2026&state=post&offset=0&limit=20
- GET /api/entity-search/clubs/{league}/{team_id}/standings?season=2026

Club search is limited to fra.1, eng.1, esp.1, ita.1, ger.1, por.1, one selected competition per request. Match history is limited to the events actually returned by ESPN for the requested season and competition; it is NOT a guaranteed complete multi-competition archive. Missing provider data must be shown as unavailable, never as a fabricated score.

People search uses Wikidata human entities, date of birth and height. Missing, ambiguous or imprecise birth dates produce no age. Deceased subjects use age at death. Height supports meters and centimeters; conflicting values produce null. No images or Wikipedia article text are copied. Wikidata source and article links are returned. Google Knowledge Graph is not integrated.

## Official accounts

Links must be created only by a trusted administrator/importer in MongoDB collection entity_links, with entity_id (e.g. espn:fra.1:TEAM_ID or wikidata:QID), user_id and approved=true. Do NOT permit users to write this collection through profile editing or generic database APIs. A unique index on entity_id is recommended before provisioning links. The linked account must currently have is_verified=true and be public, active and unblocked. Only public fields are returned. No automatic matching by username or logo, no account creation, no verification grant and no existing account migration is performed. An unlinked entity returns official_account=null.

## Remaining work

Frontend integration (cards, tabs, pinning and match-center navigation), administrator link management and live-provider/deployment smoke tests are still required. Confirm provider terms and coverage before production use.
