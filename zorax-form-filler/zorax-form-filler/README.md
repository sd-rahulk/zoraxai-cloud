# Zorax Form Filler

Editable contact profiles and one-click filling for Chrome and Microsoft Edge on desktop. Local filling works without a gateway. Connect Zorax AI Cloud for answers from a saved knowledge profile.

## Install

1. Extract this ZIP into a folder you will keep on your computer.
2. In Chrome open `chrome://extensions`, or in Edge open `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**, then select the **extension** folder inside the extracted folder (the one containing `manifest.json`).
5. Pin **Zorax Form Filler** in your browser's extensions menu.

The extension is source code you install locally; it is not a Chrome Web Store listing. Moving or deleting the installed folder can break it. Reload it on the extensions page after updating the source.

## Use

1. Click the extension icon. Create and save a profile with your own name, email and phone, including its country code. You can leave optional details blank. **Edit** changes a saved profile; **+ New** creates another.
2. Open the page containing the form. Click **Review fields** to inspect the proposed matches.
3. For local-only use, **Pick sample choices** can select the first available ordinary option for practice. When Cloud is connected, **Review fields** and **Fill this step** leave unanswered choices for review.
4. Click **Fill this step**. Review the values on the page. Correct uncertain matches in the extension's review list, then fill again.
5. Click Next or Submit yourself. On a new step, reopen the extension and fill again. Dependent fields that appear after another selection may need a second fill click.

Existing entries are preserved by default. Enable **Replace existing entries** if you want your saved profile to replace them. This also applies to dropdowns that already have an actual default selection.

## Connect Zorax AI Cloud

1. In the Zorax AI Cloud dashboard, create an API key. In **Knowledge Base**, open a profile and give that key **Extension access**.
2. In the extension, open **Zorax Cloud settings**. Enter your gateway’s HTTPS origin and either the Zorax API key or a pairing code from **API Keys**. For a local development gateway, loopback HTTP also works.
3. Click **Connect**, allow access to that gateway host, and select a knowledge profile. **Gateway default** uses the server’s default if your key has access to it. Use **Refresh profiles** after changing grants.
4. On a form, click **Review fields** to preview Cloud matches, **Fill this step** to apply valid matches, or **Fill & continue** to run across supported steps. Local values and manual mappings take precedence. Missing or incompatible answers stay untouched.

A pairing code is single-use and exchanges for a short-lived credential. Either credential is stored in extension session storage, which clears on browser restart or extension reload. Reconnect when prompted. The gateway address and selected profile ID are remembered.

## Fill & continue

For supported multistep forms, click **Fill & continue** once. The on-page Zorax panel shows progress and has a **Stop** button. You can close the popup while it works. It checks local rules first, looks up unresolved fields if Cloud is connected, and clicks a single unambiguous **Next** or **Continue** when the step is complete. Sample choices apply to local-only runs.

The popup also updates to show the current step or why the helper paused. Ordinary footer policy text is not treated as a form question. If a page explicitly says entering information counts as consent, Fill & continue pauses before writing anything so you can review the message and decide whether to continue yourself.

It pauses for a manual answer, an unsupported field or widget, a missing required value, an ambiguous navigation control, verification, or a final action. Contact details are filled, then it pauses before continuing because that action may send an enquiry. Consent and recognised financial/eligibility answers remain manual. This includes the veteran/military-status question in mortgage funnels, even when the question is visually separated from the radio choices. Existing answers are always preserved in this mode, regardless of the replacement toggle.

When it pauses, answer the necessary questions and click Continue yourself. On the next step, click **Fill & continue** again. It cannot skip a required question while proceeding past that question. Full page reloads/navigation require restarting; it does not automatically resume on a new document. There is a 30-cycle/90-second limit, and it will not repeatedly click a button when the page does not visibly change.

Submit-type Continue buttons are deliberately handed back to you because they can send the form. Other sites can also save answers or create leads as you move between steps. Review the form and use this on forms you intend to complete or are authorised to test. This feature is heuristic, not a guarantee for every website.

**Updating an existing install:** extract this ZIP, replace the old extension files with the new **extension** folder, click the extension's **Reload** button at `chrome://extensions` / `edge://extensions`, then refresh the form page. Your profiles remain if you reload the same installed extension. Removing and reinstalling it may delete its local profiles.

If a field was filled incorrectly, use **Undo last fill** before navigating away. Ordinary fields and native radio selections can be restored. Custom dropdowns and some custom radio controls require manual restoration. Undo history is temporary and resets with page navigation.

Use the keyboard shortcut **Alt+Shift+F** to open the popup where supported. Browser shortcut settings can change it.

## Unusual forms

- The review list lets you map an unrecognised field to a profile detail or supply a custom value. Mappings are remembered for that page path and field; profile mappings use the currently selected profile. Literal custom values remain as saved until changed or removed.
- Standard inputs, native dropdowns and radio buttons are supported, along with many explicitly ARIA-labelled custom controls and open shadow DOM controls.
- Embedded forms may need extra access. **Allow detected embedded forms** requests permission for the detected third-party domains. It does not grant access to every site.
- There is no universal guarantee: poorly labelled controls, closed shadow DOM, unusual widgets, browser-protected pages, inaccessible frames and site-specific validation may need manual entry.
- Contacts are copied from your profile. A missing contact value stays blank; an incompatible phone length is reported for manual review instead of silently truncating the number. Country and US-state aliases are supported, but every site's format cannot be guaranteed.

## Boundaries and privacy

The ordinary **Fill this step** action does not click Next. **Fill & continue** can click supported Next/Continue controls as described above, but stops before final actions and contact-step navigation. Consent checkboxes, passwords, files, security codes and recognised financial, health or eligibility answers remain manual. It does not solve CAPTCHAs. Review every answer before submitting. Use sample choices for practice or authorised tests; provide truthful answers on actual applications.

Local contact profiles and manual mappings are stored in this browser's extension storage. When Cloud is connected, the service worker sends unresolved field labels, input types, eligible choices, autocomplete hints, the site origin, and the selected profile ID to the configured gateway. Existing field values and local profile values stay in the browser. Server-side knowledge can be accessed only through the granted key. Once filled, values become available to the website, which may itself autosave or send them before submission.

Base permissions are active-tab access, script injection on your click, and storage. The extension requests gateway host access on connection. Access to embedded form domains is also optional and can be revoked in the browser's extension settings. There is no persistent background page monitoring.

## Practice

Double-click **practice.html**. Its own demo buttons run the same fill engine against a local example form, with fictional contact details. It does not submit anything. This checks the engine, not the installed extension's browser integration. To try the actual extension on that practice page, serve this folder over local HTTP and open it in your browser; the popup supports HTTP/HTTPS pages, not `file://` URLs.

## Validation

Thirteen original local DOM integration test groups passed; see `qa/test-results.json`. They cover profiles, exact contacts, aliases, ordinary choices, exclusions, existing entries, undo, manual mappings, page input events, dynamic fields, open shadow DOM and custom ARIA controls. Popup orchestration was tested using a mocked Chrome API. The additional runner tests and results are in `tests/test_runner.cjs` and `qa/runner-test-results.json`; they exercise navigation, handoffs, ambiguous buttons and stopping without repeated clicks.

The DOM tests stub layout visibility. Browser compatibility still depends on the form’s controls and validation. A Playwright script is included for local browser testing. No external forms were submitted.

Developers can run `tests/test_dom.cjs`, `tests/test_runner.cjs`, and `tests/test_cloud.cjs` with Node.js and a separately installed `jsdom` dependency. The extension has no runtime dependencies.
