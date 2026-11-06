# Result segmentation and local translation history

**Goal:** Default to the completed translation, prepare a readable bilingual segmented view in the background, and keep portable translation history in this browser.

**Architecture:** Keep original strings and UTF-16 ranges. Script segmentation handles sentences and long run-on clauses; the configured DeepSeek/GLM can refine correspondence asynchronously. Accept AI output only if it partitions both original strings without changing or dropping non-whitespace content. IndexedDB saves whitelisted completed results and request settings; versioned JSON provides import/export.

**Tech Stack:** Existing React/Zustand, browser Worker, EdgeOne provider adapter, IndexedDB. No new account or native conversion dependency.

The user has opted out of intermediate approval pauses. These implementation choices are ours; the requested behavior is complete translation first, optional segmented bilingual display later, plus local history import/export.

## Review focus

- A comma-only Chinese paragraph and differently segmented English must become readable groups; decimal numbers, abbreviations, quotes and Unicode remain intact.
- Late alignment and restored history must never overwrite a newer translation; failures keep the completed translation usable.
- Model-proposed strings are untrusted: only exact sequential source/target ranges are accepted; credentials and document text stay out of diagnostic logs.
- Storage failures are visible; existing history survives import failure, duplicate IDs and reload races.
- Backups contain original/translated text and explanation but no credentials, raw attachments, transient stream fragments or demonstration samples.

## Work

- [x] Add a bounded AI segmentation endpoint/client using the existing provider settings, with exact source coverage validation and cancellation. Live model behavior is not yet measured.
- [x] Improve script paragraph/sentence segmentation and prepare bilingual rows after translation; default result view to complete translation. Reuse the same ranges when making corpus.
- [x] Add IndexedDB history, request/result tracking, versioned JSON merge import/export, restoration and desktop/mobile navigation.
- [x] Verify homepage TXT / PDF / DOCX / legacy Word input detection and actual extraction, distinguish scanned PDFs, and fix observed defects. The authorized scoped checks completed with 45 passing cases.
- [x] Simplify the corpus UI with progressive disclosure, keeping basic upload/align/edit/export visible and all advanced operations reachable.
- [x] Review interaction and persistence races; type checking, lint and production build passed. No history/segmentation automated tests were added or run. Read-only review identified and rechecked fixes for merged readable spans, long-input counting cost and failed-deletion update buffering.
- [ ] Commit, publish and verify the deployed artifact revision and required resources. Browser interaction evidence remains subject to the previously reported tool restriction.
