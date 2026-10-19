# Store release preparation

Build the store ZIP with:

```sh
python3 installer/build_extension.py
```

The output is `dist/chrome-web-store/RoCreate-<version>.zip`. Its manifest is at the ZIP root. The builder removes the unpacked-only reload loop and excludes RobloxVerifieds features and its host permission from the first store build. It does not edit the development extension.

- `listing.md`: description and reviewer notes.
- `privacy-practices.md`: permission justifications and disclosure points to review in Google's dashboard.
- `dist/chrome-web-store/assets/`: prepared store images, kept out of git as build output. Dashboard examples are labelled. Game screenshots reuse the website's real logged-out captures.

Before submission, publish the current website/privacy updates, finish the developer account setup and review Google's actual data-use categories. Show nwtaken the finished listing and request approval before submitting for review or enabling automatic publication.

Validation: the actual extracted store ZIP loads in Chrome; dashboard search, sort, notes, backup/restore, permission gating and the absence of the development-update alarm were checked. Store images were checked at 1280x800 and 440x280. The ZIP is reproducible and includes a SHA-256 file. Real Roblox/RoValra validation is still pending because the test connection rejected Roblox's certificate.
