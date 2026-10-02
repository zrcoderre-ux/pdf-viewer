## Naming system (current session)

The viewer can name documents two ways:

- **Source mode (default).** Filename comes from the server / URL /
  Content-Disposition. No transformation. This is what most legitimate
  PDFs already provide.
- **Footer mode.** Reads the document title printed at the bottom of court
  filings, runs it through a rule engine in `footer-naming.js`, applies
  cross-tab disambiguation when sibling tabs would collide on the same
  canonical name.

### Three layers of control

| Layer | Storage | UI surfaces | Scope |
|---|---|---|---|
| Global default | `storage.sync.namingMode` | Popup + Options page | All viewer tabs that don't have a per-doc override |
| Per-document override | `storage.session.naming-override:{url}` | Viewer toolbar dropdown | Only the document at that URL; survives tab reload, dies on browser close |
| Effective mode | (derived) | What the toolbar actually shows | `override ?? per-document default` |

The toolbar dropdown always mirrors the effective mode. Picking something
in the toolbar creates a per-doc override; until then the toolbar tracks
the global.

### Documents opened from disk keep their name

A PDF opened from disk — `file://` in the extension, or a `File` handed to
`__pdfViewerLoadLocal` in the app — is already named, by whoever downloaded
or filed it. The naming rules exist for PDFs read *before* download, where
the name is still the viewer's to pick, so a local document is shown under
its own filename verbatim: no rule engine (not even with "apply naming rules
to source names" on), no footer title, no caption override, no part/volume
suffix, and no cross-tab disambiguation — it doesn't register in the
collision registry, so it can't push a sibling tab into qualifying its name
either. Picking a mode in the toolbar dropdown is a deliberate ask and lifts
the suppression for that one document.

`resolveNaming()` in `naming-override.js` is the one place that decides this
(`{ mode, keepSourceName }`); `viewer.js` mirrors it into `namingMode` /
`keepSourceNameAsIs`.

### Footer-naming rule engine (`footer-naming.js`)

Pipeline:

1. Normalize whitespace and curly quotes.
2. Capture case-caption party from a `X v. Y` tail and strip it. The
   captured party (e.g. `Hopkins`) is used as a Complaint disambiguator.
3. Strip case-number noise (`CASE NO. ...`) and trailing damages
   descriptive blobs (`for compensatory, punitive, ... damages`).
4. Collapse `Notice of Motion and Motion ...` to plain `Motion ...`. Bare
   `Notice of Motion for X` is preserved as its own type (a procedural
   notice).
5. Non-destructively capture the filing-party label from the leading
   possessive: `"Defendant Pacific Insurance's Demurrer"` → `"Pacific Insurance"`;
   `"Plaintiff's Complaint"` → `"Plaintiff"`; `"Receiver's Opposition"` →
   `"Receiver"`. Used as a disambiguation qualifier.
6. Walk the RULES list to identify the document type. Rules examine the
   full (still-possessive-prefixed) string and anchor on document-type
   keywords directly. Outermost wrapper wins.

Rule order (outermost wrapper first):

```
Self-titled (Errata / Notice of Ruling / Trial Brief / Memo of Costs /
Case Management Statement / …) > Response to Objections > Objection >
Declaration > Order > Proof of Service > RJN > Separate Statement >
Evidence > Notice of Non-Opposition > Reply > Opposition > Demurrer >
Notice of Motion > Ex Parte Application > Motion > Petition > Answer >
Cross-Complaint > Amended Complaint > Complaint > bare MPA
```

Order constraints that matter:
- Self-titled procedural docs first: a "NOTICE OF ERRATA RE: PLAINTIFF'S
  EVIDENCE IN OPPOSITION TO ... MOTION" is an errata notice, and would
  otherwise mislabel as Opposition.
- Response-to-objections before Objection (its title contains
  `Objections`), and Objection before every objected-to type — an
  "Objections to Declaration of X" is `Obj. to X Decl.`, not `X Decl.`
  Leading party possessives match both singular (`Defendant's`) and
  plural (`Defendants'`) forms.
- Declaration before the response/brief types (a `Decl. ISO Reply` is a
  declaration, not a reply).
- Reply before Opposition (a Reply's title contains `Opposition to ...`).
- Notice of Motion before Motion (`Notice of Motion for X` contains
  `Motion for X` as substring).
- Ex Parte Application before Motion (parallel structural overlap with
  `for X`/`to X` forms).
- FAC/SAC/TAC before Complaint (they contain `complaint` as substring).

Canonical types collapse aggressively. Standalone titles are bare:
`Motion`, `Demurrer`, `Opposition`, `Reply`, `Petition`, `Complaint`,
`Notice of Motion`, `Ex Parte Application`. The specific variant
(`Mot. to Strike`, `Demurrer to SAC`, `Opposition to Demurrer`) only
appears as a disambiguation qualifier when sibling tabs collide.

`extractTitle(raw)` returns `{ canonical, target, party, partyLabel, raw }`.

Insurance check: if input mentions `DECLARATION` or `DECL.` but a
non-declaration rule matched, recover a `{Last} Decl.` label rather than
mislabeling. Belt-and-suspenders against future rule edits.

### Cross-tab disambiguation

`disambiguation.js` writes each viewer's parsed footer attributes to
`chrome.storage.session` under a per-tab key. All viewer tabs subscribe
to changes and recompute their displayed name when siblings update.

`disambiguate(entries)` walks a 3-level ladder for colliding groups:

1. **Target only** — `Demurrer to SAC`, `Opposition to Demurrer`,
   `Mot. to Strike`.
2. **PartyLabel only** — `Receiver's Opposition`, `Pacific Insurance's
   Demurrer`, `Plaintiff's Motion`.
3. **Both** — `Receiver's Opposition to Ex Parte App.`

The algorithm stops at the first level that makes every entry in the
group unique. An entry with neither target nor partyLabel stays bare at
every level; its informed siblings move. Two bare entries that collide
remain visually identical (no synthetic numeric suffix) — the user
renames manually.

Exceptions to the ladder:
- Declarations and FAC/SAC/TAC are already distinct by name/ordinal; no
  ladder applied.
- Complaints use case-caption party (not partyLabel) as the qualifier:
  `Hopkins Complaint` vs `Complaint`.

Stale entry sweep: on `registerEntry`, the module enumerates all
`titledoc:*` session keys and removes any whose tabId no longer
corresponds to an open tab. Cheap because session storage is small.
`beforeunload` also unregisters; sweep is belt-and-suspenders.

### Per-document override (`naming-override.js`)

Tiny module: `getOverride(fileUrl)`, `setOverride(fileUrl, mode)`,
`onOverrideChange(fileUrl, cb)`. Keys session storage by file URL. The
toolbar dropdown is the only writer; the popup and options page write
only to the global key. Also holds `resolveNaming()`, the pure function that
turns (local-or-not, override, global) into the effective mode plus the
"keep the on-disk name" flag — covered by `test-naming.mjs`.

### State management in viewer.js

Four name variables coexist:
- `globalNamingMode` — mirror of `storage.sync.namingMode`
- `perDocOverride` — `getOverride(fileUrl)` result, null when unset
- `isLocalDocument` — opened from disk (`file://`, or the app's local-open path)
- `namingMode` / `keepSourceNameAsIs` — effective mode and suppression, from
  `resolveNaming()`

`resolveEffectiveNamingMode()` recomputes both after any layer changes; if
either changed, the source name is re-derived and `applyNamingMode()`
re-paints the toolbar.

`setDisplayName` now takes an `origin` tag (`"source"` or `"footer"`)
and caches both forms separately. Flipping naming mode swaps between
them with no re-extraction.

Footer extraction (`tryResolveFooterTitle`) always runs regardless of
mode — the structured result is needed for the disambiguation registry,
and toggle-flipping should be instant. Whether the result reaches the
registry is decided separately, by `syncDisambiguationEntry()`.
