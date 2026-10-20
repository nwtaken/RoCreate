# Privacy practices draft

Review these disclosures in the actual developer dashboard before submission. They describe installer/build_extension.py's output, not every possible custom build.

## Single purpose

Customize roblox.com with a cohesive interface and contextual Roblox creator information, including experience statistics, creator profiles and a personal game watchlist.

## Permission justifications

- storage: Save feature preferences, accents and watched games in Chrome extension sync storage. Keep caches, diagnostics and private game notes in local extension storage. Backup files are created only when the user requests them.
- alarms: Schedule optional player-spike and Robux sales checks every 15 minutes. Both kinds of alerts are disabled by default. Store updates use Chrome's updater; no development reload alarm is present.
- notifications: Show only the player-spike and sales notifications users explicitly enable. Clicking a notification opens the relevant game or Roblox transactions page.
- declarativeNetRequestWithHostAccess: Set the Origin header only for the extension worker's own requests to www.youtube.com/youtubei/. YouTube's channel-feed API refuses the extension origin. This does not change ordinary tab requests or filter browsing.

## Host permissions

- *.roblox.com and accountinformation.roblox.com: Run the interface on Roblox and request profile, avatar, game, community, friendship, inventory and personal Robux data for visible features. Roblox authentication is handled by normal credentialed requests; the extension does not read passwords or login-cookie values.
- creatorexchange.io: Fetch estimated revenue, public experience statistics and player histories for viewed or watched games and viewed communities.
- api.rolimons.com and www.rolimons.com: Fetch public collectibles valuations and value history for profiles being viewed.
- www.youtube.com: Resolve linked YouTube channels and retrieve their recent video metadata.
- gql.twitch.tv and static-cdn.jtvnw.net: Retrieve linked Twitch channel status, broadcasts, clips and thumbnails.
- syndication.twitter.com and pbs.twimg.com: Retrieve publicly available posts and images for linked X handles. Requests are cached and refused requests establish a cooldown.

## Data-use disclosure to review

Do not blindly select "no user data". The extension handles contextual profile/game identifiers, Roblox page content, friendship information and virtual-currency balances. Some public IDs, game names and social handles are sent to their respective services for visible lookup features; recipients also receive the ordinary IP address of the request.

The prepared dashboard draft selects Personally identifiable information (Roblox identifiers and public names), Financial and payment information (optional virtual-currency balances and transaction totals), Web history (contextual game/profile lookups, not a general history log), and Website content. Health information, Authentication information, Personal communications, Location and User activity are not selected. The three limited-use certifications are checked in the draft. Review these choices before submission.

Since 0.19 to 0.26: Quick jump sends the text a user types (after a pause, two or more characters) to Roblox's own search endpoints, like the site's search bar; review whether Google's "User activity" or "Website content" wording applies. Money tools read transaction history, community sales, audit logs and member lists from Roblox only when the user requests an export, and build the CSV locally; keep "Financial and payment information" selected and mention transaction history. Your experiences reads the user's own and managed experiences' public statistics from Roblox. None of this leaves the browser except as requests to Roblox.

Private game notes are stored locally and included only in user-requested local backups. They are not sent in statistics requests. No passwords, cookie values or payment-card data are read by extension code. No analytics or RoCreate server exists. User data is not sold or used for unrelated advertising, profiling or creditworthiness decisions.

## Remote code

Extension logic is bundled JavaScript and CSS. API responses and feed JSON are data, not evaluated code. YouTube and Twitch players load their own web pages as frames in the Roblox website, with no privileged extension execution. Review the dashboard's exact wording before certifying the remote-code answer.

## Privacy policy

https://rocreate.org/privacy.html

Publish the updated privacy page and website before submitting the store item: the new local-note and dashboard explanations must be present at this URL.
