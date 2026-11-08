# Search UI integration

SearchPage now includes Clubs and Personnalités tabs and an independent information panel above social results in Pour toi. Existing people/posts/media/hashtags/trends/lists searches remain available. ListsPanel now declares its translation hook.

Club cards open an inline detail view with season input, last/next match, paginated results/upcoming fixtures, standings with the club highlighted, and MatchCenter navigation. People cards show Wikidata description, age/age at death, height and birth date where provided, and validated source/article links. No external portraits are copied. Requests are debounced and obsolete responses ignored or cancelled. Errors do not block social results.

Official accounts are pinned only when the backend returns a verified account from an approved entity_links association. This UI does not create associations, verify accounts or auto-match usernames. An administrator must provision trusted links as described in ENTITY_SEARCH.md.

The previous backend commit must be deployed with search_app:app; a missing endpoint displays a service-unavailable message. Coverage remains six selected leagues and source-provided seasons/fixtures, not all clubs worldwide or a complete cross-competition archive. Google Knowledge Graph is not used.

Ten assertions for entitySearchUtils were executed with Node against the same utility source (links, scores, dates, match identity, rate limits, leagues). Jest tests are included. The complete React build, browser rendering, live provider calls, MongoDB link provisioning and deployed API availability have not been validated here. No manual deployment is included.
