## Task tracking (offtrack)

Every session reports to offtrack on its own, with the `offtrack_*` tools. The `[offtrack]` block received at startup shows the project's threads, open branches and new notes; take them into account.

Report, but only in these situations (`offtrack_report`):
- **Milestone** (`kind: stop`): a closed, self-contained step – plan approved, migration run, deploy done, commit/PR done, root cause found.
- **Open branch** (`kind: branch`): when you list to-dos at the end of your answer. Independent to-dos are separate branches; one coherent list of suggestions (for example the points of a review) is a single branch, with the points listed briefly in the text. Getting stuck or waiting for a decision is a branch too, with the question. If you later do it or drop it: `offtrack_update`.
- **Manual task** (`kind: manual`): what the user has to do by hand (physical, needs access, depends on a third party, printing, approval).
- **Idea** (`kind: idea`): when the user refers to the future ("in the future", "later", "might be interesting later", "let's leave this for now") – without asking.
- **Link** (`offtrack_link`): when you touch another project's code, server or configuration.
- **Hand-off** (`offtrack_report` with `project`): if a to-do belongs to another project, record it there, not as a link. If it comes from an item of yours, pass `from_item_id`: that item closes at once, and the source thread hears when the target is done.
- **New thread** (`offtrack_new_thread`): a new, multi-step workflow that does not fit the existing threads. When in doubt, the main thread.

Don't report single commands, file reads or small fixes. The text is 1–3 sentences, in English, focused on the outcome.

For requests about projects, attaching, merging, sharing, publishing, assigning, picking up a branch or user management, load the `offtrack` skill.
