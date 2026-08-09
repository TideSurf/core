# TideSurf tool reference

All 20 canonical tools, in registry order. Element IDs (`id`, `elementId`) come from `get_state` snapshots and are snapshot-scoped: they are invalid after navigation or DOM change. Tab IDs (`tabId`) come from `list_tabs`.

| tool | required inputs | optional inputs | read-only |
| --- | --- | --- | --- |
| get_state | — | maxTokens, viewport, mode, includeHidden | yes |
| navigate | url | — | no |
| click | id | — | no |
| type | id, text | clear | no |
| select | id, value | — | no |
| scroll | direction | amount | no |
| extract | selector | — | yes |
| evaluate | expression | — | no |
| list_tabs | — | — | yes |
| new_tab | — | url | no |
| switch_tab | tabId | — | yes |
| close_tab | tabId | — | no |
| search | query | maxResults | yes |
| screenshot | — | elementId, fullPage | yes |
| upload | id, filePath | — | no |
| clipboard_read | — | — | no |
| clipboard_write | text | — | no |
| download | id | downloadDir, timeout | no |
| list_skills | — | — | yes |
| read_skill | name | — | yes |

## Notes

- `get_state`: returns the compressed DOM with action IDs. `mode` is one of `full`, `minimal`, `interactive`.
- `scroll`: `direction` is `up` or `down`; `amount` is in pixels.
- `search`: searches page content and returns matching regions, cheaper than a full state dump on large pages.
- `screenshot`: defaults to the viewport; `elementId` captures one element; `fullPage: true` captures the whole scrollable page.
- `upload`: `filePath` is a local filesystem path.
- `download`: `downloadDir` defaults to the session download directory; `timeout` is in milliseconds.
- `list_skills`: lists the Agent Skills available to the agent (name and description).
- `read_skill`: returns the full skill document for one skill listed by `list_skills`.
