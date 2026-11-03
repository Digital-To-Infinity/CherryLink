# Meta setup and proof-of-connection — Milestone 0

**Status: NOT PROVEN.** This guide states what the owner must configure. It does not claim CherryLink has seen your Meta developer dashboard or published a live post.

## 1. Establish the Meta app

1. Open https://developers.facebook.com/apps/ while logged into the DTI account with the necessary business permissions.
2. Check whether a dedicated CherryLink app exists. Create a business-compatible app if not. Assign it to the DTI Meta Business portfolio.
3. Under **App settings → Basic**, obtain App ID and App Secret. Store only on the API/worker host (`META_APP_ID`, `META_APP_SECRET`). Never send the secret in a chat, browser screenshot or GitHub issue.
4. Record the app mode, ownership, approved permissions and exact API setup options displayed. These are not inferable from code or public docs.
5. Enable the Facebook Page management use case and the Instagram content management use case. Some newer apps offer Instagram **API setup with Unified Login** and do not allow the old Instagram-login flow. Use the UI actually available in the app.

## 2. Create TWO independent Facebook Login for Business configurations

**Facebook Page publishing configuration**: request the Pages asset, authorize the actual DTI Page, and select relevant permissions for the allowed flow: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` (and any additional permission Meta requires for video/Reels on this app). Obtain `config_id` and store as `META_FACEBOOK_CONFIG_ID`.

**Instagram Unified Login configuration**: select your business portfolio and Instagram professional asset. Include at least `instagram_basic` and `instagram_content_publish` (Meta may also require additional permissions in the setup; do not accept unnecessary ads or inbox scopes for V1). Obtain its **own** `config_id` and set `META_INSTAGRAM_CONFIG_ID`.

For Facebook Login-based Instagram accounts linked to a Page, `/me/accounts?fields=instagram_business_account` can discover the IG account. For Unified Login portfolios without a linked Page, identity discovery can be different. CherryLink v0.1 provides a **direct verified ID fallback** that reads the actual shared Instagram professional account through its authorized token; this is NOT proof of universal automatic account discovery. Test with your app's selected assets, adapt per observed API behavior and do not mark this milestone done until it is verified.

## 3. Exact OAuth redirect URLs

Register these URLs in Meta's login settings, matching the API deployment hostname and protocol precisely:

```
https://YOUR_API_HOST/api/connections/facebook/callback
https://YOUR_API_HOST/api/connections/instagram/callback
```

Set each corresponding `META_*_REDIRECT_URI`. For local tests only, `http://localhost:3001` is used (Meta may restrict non-HTTPS redirects; use an HTTPS tunnel for testing if necessary). Config-based OAuth uses a server-side random, one-use state hash to prevent callback forgery. Do not pass a raw permission `scope` list alongside `config_id` without verifying Meta's current rules.

## 4. User permissions and assets

For Page posting, the Page must be owned or shared with the signing-in identity and expose `CREATE_CONTENT` in its `tasks` list. The Page access token must be stored separately from the business integration token. Instagram must be a Business or Creator professional account and share **publishing** rights with the app. Do not attempt to publish to personal Instagram accounts or personal Facebook profiles.

**Meta App Review:** Standard Access normally supports connected app-role users/assets for testing; Advanced Access and potentially Business Verification are necessary to onboard arbitrary external customers. Review needs may vary by use case and Meta account status. Document any restrictions separately from application defects.

**Webhooks:** basic scheduler/publishing does not depend on webhooks. Optional permission-revocation and deauthorization signals are useful for account health and should be added and tested before broad public rollout. Complete any dashboard-required data deletion or deauthorization configuration.

## 5. API proof checklist (run only with permission)

After OAuth, verify each request with the *right token type* and the configured API version. Below examples use shell environment variables and an Authorization header, not token-bearing URLs:

```bash
export META_GRAPH_VERSION=v26.0
# Meta User or authorized Business Integration token:
curl -sS -H "Authorization: Bearer $META_USER_TOKEN" \
  "https://graph.facebook.com/$META_GRAPH_VERSION/me/accounts?fields=id,name,tasks,access_token,instagram_business_account"
# For the selected Page (use its Page token):
curl -sS -H "Authorization: Bearer $META_PAGE_TOKEN" \
  "https://graph.facebook.com/$META_GRAPH_VERSION/$META_PAGE_ID?fields=id,name"
# Check Instagram professional account using authorized IG-capable token:
curl -sS -H "Authorization: Bearer $META_IG_TOKEN" \
  "https://graph.facebook.com/$META_GRAPH_VERSION/$META_IG_ID?fields=id,username,account_type"
```

The API's OAuth callback can discover and securely store Page tokens, while `/api/connections/instagram/verify-asset` verifies a Unified Login Instagram ID when automatic discovery does not return it. Never copy tokens into pull requests or screenshots.

## 6. Live posting proof (only after credentials validated)

1. Connect the DTI Page, check `CREATE_CONTENT`, and publish a harmless authorized **text test** via a Page token. Read the provider post ID and permalink.
2. Publish a JPEG image using `/PAGE_ID/photos`, capture the returned identifier, and verify in the Page UI.
3. Publish a valid 9:16 Page Reel using the Meta Page Reels upload-phase start → upload → finish flow; confirm the Reel is actually visible and retain the provider ID.
4. Connect the DTI professional Instagram account via the correct configuration and retrieve its ID; verify `instagram_basic` + `instagram_content_publish` (and applicable asset grants).
5. POST `/IG_ID/media` with a Meta-fetchable JPEG URL; poll `/{container_id}?fields=status_code` until `FINISHED`; POST `/IG_ID/media_publish` and verify its returned media ID and permalink.
6. Repeat using `media_type=REELS`, `video_url=...`, and the supported upload flow. Capture time, HTTP status, error code, operation IDs and limits without exposing tokens.
7. Test scheduled delivery while all browser windows are closed, worker restart, rate-limit handling and uncertain-response reconciliation.

**Never mark live publication as passed because a container was created, the scheduled post was saved, or a mock returned success.**

## 7. Record evidence in the acceptance ledger

Capture: Meta App ID (not secret), configuration ID (identifier only), configured permission names, token type and expiry, approved asset IDs, Graph API version, HTTP status (redacted), returned post IDs/permalinks and test timestamp. Update `docs/ACCEPTANCE.md` only with evidence from real API calls.

## Official references

- https://www.postman.com/meta/instagram/overview
- https://www.postman.com/meta/instagram/folder/830j7my/reels-publishing
- https://www.postman.com/meta/facebook/overview
- https://developers.facebook.com/docs/graph-api/changelog/

Unified Login is a newer configuration than many public Postman examples. Treat your app dashboard and latest platform reference as the final authority for exact configuration screens and asset-discovery endpoints.
