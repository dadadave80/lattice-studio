# Manual accessibility checks

The automated suite next to this file (`bun run e2e apps/studio/e2e/a11y`) runs axe in every state, checks focus after every dialog and walks the F6 and Tab order. axe misses most of what makes Studio usable without a mouse, so before each minor release a person runs the twelve keyboard scripts below (spec L798) and the screen-reader passes in the matrix at the end (spec L799). Both are release gates in [`docs/release.md`](../../../../docs/release.md#the-v1-cut-line).

Run all twelve with the keyboard only, then again under each screen reader in the matrix.

## Before you start

- **Build.** Use the release candidate's preview deployment, or `bun run build` and then `bun run preview` from this checkout, so the pass runs on what ships.
- **Window.** A desktop browser at 1280 × 800 or larger, page zoom 100%, unless the script says otherwise.
- **Mouse.** Leave it alone once the page has loaded, except where a step says "with a pointer".
- **Reaching a card.** F6 into the Sheet lands on the Sheet region itself until something inside it has had focus; after that it returns to what last had focus there. From the region, Home focuses and selects the first card in reading order, End the last.
- **Wallet.** S9 needs a browser wallet with a little Sepolia ETH. Every other script works without one.
- **Keys.** Mod is ⌘ on macOS and Ctrl on Windows and Linux. On Mac laptops, press fn with F6 and F8, which are media keys there. The Keyboard shortcuts dialog (?) shows each key as your platform writes it.
- **What you should hear.** Quoted text after "hear" is what Studio puts in its polite status region, so a screen reader reads it after a short pause; without a screen reader, watch that region in the browser's accessibility inspector instead. Names and roles in "Expect" are what the accessibility tree reports: your screen reader may word the role differently ("facet card" for a card, "group" in some readers).
- **Screen-reader modes.** The sheet is an application region ("Diamond sheet"), so NVDA and JAWS switch to focus mode inside it. Everywhere else, browse mode takes letter keys for quick navigation, so single-key shortcuts like H or T reach Studio only in focus mode. That's expected; note it only if a reader stays in browse mode inside the sheet. With VoiceOver, turn Quick Nav off.

### Starting projects

Every script starts from one of these. Open the command palette with Mod+K, type "New project" and press Enter to start each one fresh.

- **Empty.** A new project with nothing placed: the sheet shows the "Start a diamond" block.
- **ERC20.** From Empty: Tab to **ERC20** in the Start a diamond block and press Enter. The sheet shows the ERC20 and Receive cards, and the core cell sits at the bottom of the sheet. Focus is on the Sheet region itself, not on a card.
- **Collisions.** From Empty: F6 to the Console, Tab to the command line ("Command line"), and run these one at a time:

  ```
  place axelargatewayadapter
  place zetachaingatewayadapter
  place ccipgatewayadapter
  ```

  Three cards that collide: AxelarGatewayAdapter with ZetaChainGatewayAdapter on `gateway`, `sendMessage` and `supportsAttribute`, and with CCIPGatewayAdapter on `sendMessage` and `supportsAttribute`. The collisions draw "Selector collision" notes on the sheet. Focus stays on the command line, and nothing on the sheet has had focus yet.

### Recording a result

A script passes when every "Expect" holds. When one doesn't, write the script and step number ("S4.3") in the matrix cell, file an issue, and put its number next to it. A step you can't run (no wallet, a key the platform takes) is "blocked", with the reason.

## The scripts

### S1 · Skip to sheet

Spec L743, L745, L751 · WCAG 2.4.1, 2.4.3, 2.4.7, 2.1.2.

Start: **ERC20**. Reload the page and don't touch it with the mouse.

1. Press Tab. In Safari, press ⌥Tab unless "Press Tab to highlight each item" is on.
   Expect: a "Skip to sheet" link appears at the top left with a 2 px focus outline. It's the first stop.
2. Press Enter.
   Expect: focus is on the ERC20 card, with its outline. Hear its name, "ERC20, 9 selectors", and its description, "9 of 9 selectors routed to the diamond. Not selected."
3. Press Tab, and keep pressing it.
   Expect, in order: the tool strip's **Select** button (one stop for the whole strip), the zoom readout ("Zoom" and the percentage), the title block's **Collapse title block**, **Chain and path: Choose a chain · LatticeFactory** and **Deploy…**, then the core cell, "Core The diamond's fixed part". The next Tab leaves the sheet for the "Resize inspector" splitter. Focus never gets stuck in the sheet.
4. Press ⇧Tab until you're back on the card.
   Expect: the same stops in reverse.
5. Tab to the core cell again. Press ↓ six times, then Home.
   Expect: focus walks the cell's rows: "Collapse the core cell", "Fallback 15 routed", "Loupe 4/4, 4 of 4 covered", "ERC-165, covered", "Cut Empty · immutable", and the sixth ↓ wraps to "Core The diamond's fixed part". Home goes back to the first row.
6. Press Space.
   Expect: hear "Selected the core." The inspector's heading reads "Core · the diamond's fixed part".
7. Press ↓ to "Collapse the core cell" and press Enter, then Enter again.
   Expect: the cell folds to one line and focus moves to "Expand the core cell"; the second Enter unfolds it with focus back on "Collapse the core cell".
8. Open a new **Empty** project, reload, press Tab and Enter.
   Expect: on an empty sheet the Start block takes the card grid's place: focus lands on **Blank diamond**, and Tab goes on to **GovernedVault**, **ERC20**, **SafeDiamondCut**, **Browse all recipes** and **Take the 60-second tour** before the tool strip.

Pass when the link is first, visible on focus, lands in the sheet, and Tab leaves the sheet in the order above.

### S2 · F6 and Ctrl+F6, with a toast showing

Spec L743, L733 · IR "Keyboard" (F6) · WCAG 2.4.1, 2.1.1.

Start: **Collisions**, with focus still on the console's command line, where the start state leaves it.

1. Press F6 six times.
   Expect: focus moves to each region in turn, and the reader names it: "Title bar", "Left pane", "Sheet", "Inspector", "Console", then "Title bar" again. Entering a region puts focus back where it last was inside it, or on the region itself.
2. Press ⇧F6 five times.
   Expect: the same regions in reverse.
3. On Windows and Linux only: repeat steps 1 and 2 with Ctrl+F6 and Ctrl+⇧F6.
   Expect: the same cycle. On macOS, Studio doesn't bind Ctrl+F6.
4. F6 to the Sheet, which lands on the Sheet region, and press Home. Then press Mod+A, then Delete.
   Expect: Home focuses AxelarGatewayAdapter; hear "Selected AxelarGatewayAdapter.", then "Selected 3 cards." then "Removed AxelarGatewayAdapter, ZetaChainGatewayAdapter and CCIPGatewayAdapter." (in the sheet's reading order). A toast, "Removed 3 facets" with **Undo**, appears. Focus stays on the sheet: a toast never takes focus.
5. Within 10 seconds, press F6 until you reach Notifications.
   Expect: after the Console comes "Notifications", then F6 goes on to "Title bar". ⇧F6 from the Title bar comes back to "Notifications", then "Console".
6. From Notifications, press Tab twice, wait 15 seconds, then press Enter.
   Expect: the first Tab reaches the toast, "Removed 3 facets"; the second reaches **Undo**. The toast stays while focus is in it. Enter restores all three cards, says "Undid: Removed …" with the same list, and moves focus to a restored card on the sheet.
7. Press F6 five times, around the cycle and back to the Sheet.
   Expect: "Inspector", "Console", "Title bar", "Left pane", "Sheet": no Notifications stop now that no toast shows. Focus is back on the restored card.
8. Open Settings (Mod+K, "Open Settings", Enter) and press F6.
   Expect: focus stays in the dialog; hear "A dialog is open. Close it to move between regions." Esc closes Settings and focus returns to the card.

Pass when the cycle is complete in both directions, Notifications joins it only while a toast shows, and the toast never takes focus on its own.

### S3 · Placing from the tree without triggering Tidy

Spec L761, L776 · Flow 3, Flow 4 · WCAG 2.1.1, 2.5.7, 4.1.3.

Start: **ERC20**, with focus on the Sheet region, where the start state leaves it. Note where the two cards sit.

1. Press /.
   Expect: focus moves to the catalog's **Search** field in the Left pane.
2. Type `erc4626`.
   Expect: hear "1 match." The catalog tree shows Tokens with ERC4626 under it.
3. Press Tab until you reach the tree, then ↓.
   Expect: Tab passes the **Available on chain** checkbox, which reads as unavailable with "Choose a chain first.", and lands on "Tokens", which says "1 on sheet" for ERC20. ↓ moves to the ERC4626 row, which reads "ERC4626 17 selectors erc7201:lattice.storage.ERC4626".
4. Press Enter.
   Expect: hear "Placed ERC4626 · 17 selectors · erc7201:lattice.storage.ERC4626". The row now reads "On sheet" and keeps focus. On the sheet, ERC4626 appears in free space; ERC20 and Receive haven't moved, and nothing says "Tidied".
5. Press Mod+Z.
   Expect: hear "Undid: Placed ERC4626." The card goes; focus stays on the row.
6. Press ⇧F10 (or the Menu key).
   Expect: a menu "ERC4626 actions" with **Place**, **Preview** and **Open source on GitHub**. Esc closes it and focus returns to the row.
7. Now resolve a collision. Open **Collisions**, F6 to the Sheet and press F8.
   Expect: focus moves to the first "Selector collision" note; hear "Selector collision" with "gateway() 0x116191b6" and "Only one facet can serve each selector."
8. Press Tab twice, then Enter.
   Expect: Tab reaches **Keep AxelarGatewayAdapter**, then **Route to ZetaChainGatewayAdapter**. Enter says "Routed `gateway · 0x116191b6` to ZetaChainGatewayAdapter." and focus moves to the AxelarGatewayAdapter card, whose name now includes "1 served by another facet". Note whether your reader speaks the backticks.
9. Press Mod+Z.
   Expect: hear "Undid: Routed `gateway · 0x116191b6` to ZetaChainGatewayAdapter."

Pass when placing from the tree never moves the cards already there, every step is announced, and focus stays where the person was working.

### S4 · Move to… without dragging

Spec L762 · Flow 8 · IR "Pointer and touch" (Move to…) · WCAG 2.5.7, 2.1.1.

Start: **Collisions**. F6 to the Sheet.

1. Press Home.
   Expect: hear "Selected" and the first card in reading order, for example "Selected AxelarGatewayAdapter." The card shows the accent border and corner ticks; its description ends "Selected."
2. Press M.
   Expect: hear "Moving AxelarGatewayAdapter. Click the destination, or move with the arrows and press Enter. Esc cancels." A ghost of the card appears.
3. Press → three times, then ⇧↓.
   Expect: the ghost moves; each stop says where it is in words, for example "Moving AxelarGatewayAdapter, beside ZetaChainGatewayAdapter." Nothing gives a position in pixels.
4. Press Enter.
   Expect: the card drops there; hear "Moved AxelarGatewayAdapter," and where, for example "above CCIPGatewayAdapter." Focus is on the moved card.
5. Press M, →, then Esc.
   Expect: hear "Move canceled." The card stays where step 4 left it.
6. Press Mod+Z.
   Expect: hear "Undid: Moved AxelarGatewayAdapter." The card goes back to where it started.
7. Press ⇧F10 on the card.
   Expect: a menu "AxelarGatewayAdapter actions" with **Open in inspector**, **Locate**, **Move to…**, **Flip pins**, **Expand**, **Route contested selectors here** and **Remove**. Choose **Move to…**: the same "Moving …" announcement as step 2. Esc cancels.
8. With a pointer: right-click a card, choose **Move to…**, move the pointer and click once on empty sheet.
   Expect: the card moves with one click and no drag.
9. F6 to the Left pane and Tab to the **Catalog** tab. Press → to **Structure** (hear "Showing Structure.") and Enter, then Tab twice into the tree (the first stop is the tab panel), and press ⇧F10 on the AxelarGatewayAdapter row.
   Expect: the same facet menu as step 7, **Move to…** included, without **Expand**, which only a card's menu has. Choosing it says "Moving …" as in step 2 and focus goes back to the tree row. → still moves the ghost ("Moving AxelarGatewayAdapter, beside …"), and Enter drops the card and moves focus to it on the sheet.

Pass when a card can be moved with the keyboard alone and with single clicks alone, and every stop is spoken in words.

### S5 · Merged nudge announcements

Spec L776, L766 · Flow 8 · IR "Keyboard" (Arrows) · WCAG 4.1.3.

Start: **Collisions**. F6 to the Sheet, press Home to select the first card.

1. Press → five times quickly.
   Expect: the card moves right by 8 px a press. You hear one message, not five, once you stop: "Moved AxelarGatewayAdapter right," and its neighbor in words, for example "beside ZetaChainGatewayAdapter".
2. Wait for step 1's message, then press ⇧↑ twice quickly.
   Expect: 32 px a press; one message, "Moved AxelarGatewayAdapter up, …". Presses less than a second apart are one burst, whichever arrow; the pause before this step makes it a burst of its own.
3. Press Mod+Z twice.
   Expect: each one says "Undid: Moved AxelarGatewayAdapter." and reverses a whole burst. The first puts the card back where step 2 started, the second where step 1 started. Stop there: a third Mod+Z would undo the start state's last placement ("Undid: Placed CCIPGatewayAdapter.").
4. Hold → for three seconds.
   Expect: a message arrives within about 1.5 seconds, while the key is still held, not only after release. Press Mod+Z to put the card back.
5. Press Esc to clear the selection, then →.
   Expect: with no card selected, arrows scroll the sheet instead: hear "Scrolled the sheet right."
6. Press Mod+→.
   Expect: focus and selection move to the nearest card to the right; hear "Selected" and its name. On macOS the browser doesn't go Back or Forward.
7. Press =, −, ⇧0, ⇧1 and ⇧2.
   Expect: zoom in, zoom out, 100%, Fit and Zoom to selection; the zoom readout updates. ⇧0 at 100% says "Already at 100%".

Pass when every burst gives one message with positions in words, and one undo reverses each burst.

### S6 · Focus after delete and undo

Spec L755 · Flow 9 · WCAG 2.4.3.

Start: **Collisions**. F6 to the Sheet, press Home, then Mod+→ to select the middle card in reading order.

1. Press Delete.
   Expect: hear "Removed" and its name. Focus moves to the next card in reading order, and the reader names it.
2. Press Mod+Z.
   Expect: hear "Undid: Removed …". The card is back and has focus.
3. Press ⇧Mod+Z (or Ctrl+Y on Windows and Linux).
   Expect: hear "Redid: Removed …". Focus moves to the next card again.
4. Press Mod+Z, then End, then Delete.
   Expect: the last card in reading order goes, and focus moves to the previous card.
5. Press Mod+A, then Backspace.
   Expect: every card goes; focus moves to the Sheet region. Mod+Z brings them back and focuses a restored card.
6. Press Mod+A, then T. Then press Home, then F.
   Expect: focus stays on the card it was on. Two cards are left after step 4, so Tidy says "Tidied 2 facets." (or "Nothing moved: the sheet already has this layout." when they're already tidy); Flip says "Flipped pins on" and the card's name.
7. Open a new **Empty** project, F6 to the Title bar, and Tab to **Undo**, then **Redo**.
   Expect: a new project starts with no history. Undo reads as unavailable with the reason "Nothing to undo", and Redo with "Nothing to redo". Both still take focus. Mod+Z says "Nothing to undo".

Pass when focus always lands on a card that exists, or on the sheet when none does, and never on the page body.

### S7 · Shortcuts switched off

Spec L753, L754, L659 · Flow 16 · IR "Keyboard" (¹) · WCAG 2.1.4.

Start: **Collisions**. F6 to the Sheet, which lands on the Sheet region, and press Home: focus and selection move to AxelarGatewayAdapter.

1. Press H, then V.
   Expect: H turns on the Hand tool (the **Hand** button reads pressed); V turns Select back on.
2. Open Settings: Mod+K, type `Open Settings`, Enter.
   Expect: the Settings dialog opens with focus on the **Appearance** tab.
3. Press ↓ twice, then Enter.
   Expect: the tabs run top to bottom: ↓ moves focus through **Canvas** to **Keyboard**, and Enter shows the Keyboard group.
4. Tab to the **Single-key shortcuts** switch and press Space.
   Expect: it reads "Single-key shortcuts, switch, off", with its description "Shortcuts match the character a key types, so they follow the person's layout; letter shortcuts fall back to the key's position on non-Latin layouts."
5. Press Esc.
   Expect: Settings closes and focus returns to the card.
6. Press H, ?, T, M, I, F, /, = and ⇧1, one at a time.
   Expect: nothing happens and nothing is said. The Hand tool stays off, no dialog opens.
7. Press Home, →, Mod+A, F8 and F6.
   Expect: these still work, because they aren't single keys.
8. Tab to the tool strip, which is one stop and lands on **Select**, and press ↓ to the **Hand** button.
   Expect: the reader no longer announces a shortcut for it (`aria-keyshortcuts` is gone).
9. Mod+K, type `Show keyboard shortcuts`, Enter.
   Expect: the dialog says "Single-key shortcuts are off. Settings → Keyboard turns them on." and lists no single-key rows.
10. Back in Settings → Keyboard, Tab to the **Change…** button on the Tidy row and press Enter, then Esc.
    Expect: the same button reads "Press a key, or Esc to cancel" while it listens; Esc cancels and focus stays on **Change…**. Repeat with Backspace instead of Esc: the row reads "No shortcut". Then **Reset all shortcuts** restores it.
11. Turn **Single-key shortcuts** back on. In the catalog **Search** field (press /), the console's **Filter the log** field (⇧Tab back from the **Command line**) and the **Command line**, type `h?i`.
    Expect: each field takes the text; no tool changes, no dialog opens.

Pass when no single key fires while they're off or while typing, and every modified key still works.

### S8 · Palette, dialogs and menus

Spec L658-L660, L778 · IR "Command palette", "Dialogs", "Context menus", "Console drawer" · WCAG 2.1.1, 2.4.3, 4.1.2.

Start: **Collisions**. F6 to the Sheet, which lands on the Sheet region, and press Home: focus and selection move to AxelarGatewayAdapter.

1. Press Mod+K.
   Expect: the palette opens with focus in "Search commands, facets and recipes". A Suggested group comes first (for a collision: **Keep …**, **Route to …**, **Next problem**).
2. Press ↓ a few times.
   Expect: the reader names each row with its category and shortcut. Rows that can't run say why after a dot, for example "Tidy selection · Select two or more cards".
3. Type `go to`.
   Expect: **Go to console**, **Go to inspector**, **Go to left pane**, **Go to sheet** and **Go to title bar**. Choose **Go to inspector** with Enter: the palette closes and focus is in the Inspector.
   Known gap (2026-10-06): focus goes back to where the palette was opened, the card, instead of to the Inspector; F6 still reaches it. The other **Go to …** rows do the same. Until that's fixed this step fails on where focus goes.
4. Press Mod+K, type `tidy`, press Enter.
   Expect: the palette closes and Studio says what Tidy did, for example "Tidied 3 facets.", or "Nothing moved: the sheet already has this layout." when the cards are already tidy.
5. Press Mod+K, then Esc.
   Expect: the palette closes and focus returns where it was.
6. Open Settings through the palette and press Mod+K and ?.
   Expect: neither opens anything over the dialog. Esc closes Settings and focus returns to where it was before the palette opened: the AxelarGatewayAdapter card while step 3's known gap stands.
7. F6 to the Title bar, Tab to **Lattice Studio** and press Enter.
   Expect: the app menu opens with focus inside it; ↑ and ↓ move between items, Esc closes it and focus returns to **Lattice Studio**.
8. F6 to the Console, which returns to the **Command line**, then ⇧Tab to **Export** and press Enter.
   Expect: the "Export" menu opens; Esc returns focus to **Export**.
9. In the Console, Tab to the **Command line** and run `help`.
   Expect: hear "Commands: chain, deploy, clear, help, find, problems, export, new, theme, zoom, fit, init, core, next, place, remove, route, exclude, include, recipe, set, tidy, undo, redo. Type help <verb> for one." ↑ brings back `help`.
10. ⇧Tab into the log (past **Jump to latest** when it shows), then ↑ and ↓.
    Expect: the log is a "Log" with one line per entry, each read with its tag ("Note", "Placed", "Error"…). On macOS, Ctrl+L clears it and focus stays in the Console; elsewhere use **Clear the log**.
    Known gap (2026-10-06): with focus on a log line, Ctrl+L clears the log and focus falls to the page body. Until that's fixed this step fails on where focus goes.
11. On the Sheet, Tab to a "Selector collision" note's **Choose per selector…** and press Enter, then Esc. Do the same for **Browse all recipes** on an Empty sheet.
    Expect: each opens with focus inside, and Esc returns focus to the button that opened it.

Pass when every dialog and menu takes focus, is named, closes with Esc, and returns focus to what opened it.

### S9 · Deploy, with paste

Spec L561-L574, L778, L791-L792 · Flow 7, Flow 12, Flow 14 · WCAG 3.3.4, 2.2.1, 2.1.1, 4.1.3.

Start: **ERC20**. Copy two short texts somewhere first (a token name and a symbol) so you can paste them.

1. Press Home to focus the ERC20 card, then F8.
   Expect: hear "Warning: 2 fields still use example values, including name (Example Token) and symbol (EXT)." The inspector shows INIT-05.
2. F6 to the Inspector, Tab to **Review fields** and press Enter.
   Expect: the init editor opens with focus in the first field.
3. Select the field's text, paste the name, and press Tab. Paste the symbol in the next field and press Tab.
   Expect: paste works in each field, and leaving a changed field says "Set {field} to {value}." Address fields, such as the Safe's in **Choose an upgrade mechanism…**, also take a paste: they trim spaces, accept any case and store the address checksummed.
4. F6 to the Title bar (Mod+Enter doesn't fire inside a text field), then press Mod+Enter.
   Expect: the review opens as a dialog named "Deploy" and the project's name, "Deploy Untitled" on this start state, with focus on its heading. Its sections are regions: Network, Deployer, Address, What gets cut, Init, Authority after deploy, Checks, Cost, Simulation.
5. Tab to the **Chain** combobox, choose Sepolia with the arrows and Enter.
   Expect: the Network section reads the chain; nothing in the review is timed.
6. Tab to your wallet's button under Deployer and connect.
   Expect: the Deployer section names the account; Cost and Simulation fill in. The footer says what's still missing, for example "Tick the 2 acknowledgements first", and **Sign & deploy** stays unavailable until it's done.
7. Tab to each checkbox under Checks and press Space.
   Expect: each one reads its label and state. Ticking re-simulates; **Sign & deploy** becomes available.
8. Press Esc, then Mod+Enter again.
   Expect: Esc closes the review and focus returns to the Title bar, on **Lattice Studio**. Mod+Enter reopens it with the ticks still there. With a pointer, a click on the scrim leaves the review open.
9. Tab to **Sign & deploy**, press Enter, and reject the request in the wallet.
   Expect: focus stays in the review; Studio says "You canceled in your wallet." and the button now reads **Sign again**.
10. Press **Sign again** and approve in the wallet.
    Expect: no hold-to-confirm; one press signs. The review shows "Live · Sepolia", the address, **Copy address** and **Close**, and focus stays inside the review. The console logs "Deployed at …" and then the verification line.
    Known gap (2026-10-06): on a local Anvil deploy, focus falls to the page body once **Sign & deploy** is replaced by the result. Until that's fixed this step fails on "focus stays inside the review".
11. In Settings → Deploy, set **Deploy announcements** to **Everything**, then run steps 4 to 10 again after **Use a new salt** in the Address section.
    Expect: with **Errors** (the default) only failures are spoken; with **Everything** each deploy line is spoken too; with **Nothing**, none.
12. Turn the network off (the browser's offline mode, or Wi-Fi off) and press Mod+Enter.
    Expect: no review opens; hear "Deploy needs a connection". **Deploy…** reads as unavailable with the same reason. Turn the network back on.
13. Mainnet only, once mainnet is enabled (v1 ships testnets only, so skip this step until then): on a mainnet, the review shows "This deploys unaudited code: Lattice's README says it's unaudited, and so does CreateX's." and a field "Type {project name} to confirm". Paste the project name.
    Expect: paste is accepted; a mismatch says "That doesn't match. Type the project name exactly as shown: {project name}" in words.

Pass when the whole deploy runs from the keyboard, paste works everywhere text is asked for, nothing is timed, and failures are spoken with focus kept in the review.

### S10 · Toasts

Spec L733-L735 · Flow 10 · WCAG 2.2.1, 2.4.3, 4.1.3.

Start: **Collisions**. F6 to the Sheet.

1. Press Mod+A, then Delete. Don't touch anything for 12 seconds.
   Expect: the toast "Removed 3 facets" with **Undo** shows, focus stays on the sheet, and the toast leaves on its own after about 10 seconds (6 seconds for a toast without an action). The Console keeps a line for it.
2. Press Mod+Z, then delete all three again. This time hover the toast with a pointer for 15 seconds, then move away.
   Expect: it stays while hovered and leaves about 10 seconds after.
3. Delete all three again and F6 to Notifications. Tab to the toast, then to **Undo**, then once more.
   Expect: the toast reads "Removed 3 facets"; Tab reaches **Undo**, then **Close**. Enter on **Close** removes the toast, and focus moves to a control that's still there.
   Known gap (2026-10-06): focus falls to the page body when the toast closes. Until that's fixed this step fails on where focus goes.
4. Press Mod+Z.
   Expect: the same undo the toast offered, without the toast. Every toast action has another path.
5. Share a link: F6 to the Title bar, Tab to **Share** and press Enter.
   Expect: "Link copied" and the link's length in characters, as a toast. When the browser blocks the clipboard, the link shows selected under **Share** with "Press ⌘C to copy" ("Press Ctrl+C to copy" on Windows and Linux); Esc or Tab closes it and focus returns to **Share**.
6. Open Projects (Mod+K, `Projects`, Enter) and press **Delete** on a project you don't need.
   Expect: no confirmation; a toast "Moved {name} to Recently deleted" with **Undo**.
7. Open a damaged link: add `#s=1.broken` to Studio's address and load it.
   Expect: an error toast, "This link is damaged: its recipe doesn't decompress. Ask for the link again.", marked "Error". It stays until you close it.

Pass when no toast takes focus, every toast is reachable with F6, each pauses while hovered or focused, and errors stay until closed.

### S11 · 400% zoom

Spec L770-L771, L360 · WCAG 1.4.10, 1.4.4, 2.4.11.

Start: **ERC20**, browser window 1280 px wide. Zoom the browser to 400% with Mod and + (Studio leaves Mod with +, − and 0 to the browser).

1. Look at the page.
   Expect: one pane at a time, with a "Panes" tab list in the title bar: **Sheet**, **Structure**, **Catalog**, **Inspector** and **Console**. The title bar keeps **Lattice Studio**, the project name, the status chip, **Deploy…** and **More**. No horizontal scroll bar on the page.
2. Press Tab from the top.
   Expect: Skip to sheet, the title bar's controls, the Panes tab list, then the sheet's card and its zoom readout. Every stop shows its outline, fully visible.
3. Move along the Panes tabs with → and open each with Enter.
   Expect: each pane fills the screen and works: place a facet from Catalog, read a problem in Inspector, run `help` from Console.
4. Open the palette (Mod+K) and the deploy review (Mod+Enter).
   Expect: both fit the width; the review runs full height; nothing is cut off without a way to scroll to it.
5. On the Sheet, move between cards with Home, End and Mod+arrows.
   Expect: each focused card is brought into view and isn't covered by the zoom readout, notes or toasts.
6. Return to 100%.
   Expect: the full layout comes back with focus where it was.

Pass when everything is reachable at 400% without horizontal scrolling of the page and nothing focused is hidden.

### S12 · Text spacing

Spec L787 · WCAG 1.4.12.

Start: **Collisions**, then each of the screens listed in step 2.

1. Apply WCAG's text-spacing values. In the browser's DevTools console run:

   ```js
   const spacing = new CSSStyleSheet();
   spacing.replaceSync("*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}");
   document.adoptedStyleSheets = [...document.adoptedStyleSheets, spacing];
   ```

   A constructed style sheet passes Studio's Content Security Policy, which refuses an injected `<style>` element, and it applies to dialogs opened afterwards too.
2. Look at: cards at 100% zoom, a collision note, the title block, the core cell, the Structure tree, the inspector, the console and its log, the palette, Settings → Keyboard, the deploy review, a toast.
   Expect: no text is clipped, cut off or overlapping; long selector signatures wrap instead of running out of their box; buttons still show their whole label.
3. Reload to remove the styles.

Pass when every listed screen stays readable with the spacing applied.

## Screen-reader matrix

Run the twelve scripts under each pairing below before every minor release, tier 1 first (spec L799). S11 and S12 are visual checks, so they're marked n/a for screen readers; the magnifier row covers them. In each cell write **Pass**, **Fail S{n}.{step} #{issue}** or **Blocked** with the reason.

Release: ________ · Commit: ________ · Date: ________ · Tester: ________

| Tier | Screen reader and browser | Versions | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S12 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | Keyboard only, Chrome | | | | | | | | | | | | | |
| — | Keyboard only, Safari | | | | | | | | | | | | | |
| — | Keyboard only, Firefox | | | | | | | | | | | | | |
| 1 | NVDA with Chrome (Windows) | | | | | | | | | | | | n/a | n/a |
| 1 | JAWS with Chrome (Windows) | | | | | | | | | | | | n/a | n/a |
| 1 | VoiceOver with Safari (macOS) | | | | | | | | | | | | n/a | n/a |
| 2 | NVDA with Firefox (Windows) | | | | | | | | | | | | n/a | n/a |
| 2 | JAWS with Edge (Windows) | | | | | | | | | | | | n/a | n/a |

The spec also asks for these (L799). Run the named scripts with each, and record the result the same way.

| Check | What to run | What to look for | Versions | Result |
| --- | --- | --- | --- | --- |
| Windows contrast themes (forced colors) | S1, S3, S4, S8 under a Windows contrast theme in Chrome or Edge | Card borders and traces in the theme's text color, selection and focus in its highlight color, collision ties still dashed, the dot grid hidden, every focus outline visible | | |
| Voice control (Voice Control on macOS, Voice Access on Windows) | S3, S4, S8, S9 by voice | Every visible label works as a spoken command ("Click Deploy", "Click Route to ZetaChainGatewayAdapter"), and numbered overlays reach every control | | |
| Magnifier at 200% to 400% (Zoom on macOS, Magnifier on Windows) | S4, S5, S9, S10, S11 | Focus tracking follows the focused card, note and dialog; toasts and the status chip are reachable by panning; nothing needs both a far edge and the center of the screen at once | | |
