---
name: offtrack
description: Operations of the offtrack tracker. Load it when the user asks for their projects or a project's open items, wants to attach a session to a project, merge projects, share or hand over a project, hand an item off to another project or a coworker, look up coworkers or manage coworks, publish an idea, assign a manual task to someone else, pick up an offtrack branch from a prompt pasted from the clipboard, or manage users, tokens or the allowlist, or when called as /offtrack.
---

# offtrack

offtrack is the Offsite Solutions tracker: every Claude Code session reports to it, and the user sees on a map where every thread stands. The reporting rules are in the offtrack block of `~/.claude/CLAUDE.md`; this skill covers the less frequent operations.

## Setup

This skill works with the offtrack client, which provides the `offtrack` command, the hooks and the `offtrack_*` tools. If they are missing, ask the user to run these in a terminal (needs macOS or Windows, Claude Code, Node.js 22+ and git):

```sh
npm install -g github:offsite-solutions/offtrack-client
offtrack install
offtrack login
```

They generate the client token at https://offtrack.offsite-solutions.com/install after signing in with a Google, Microsoft, GitHub or GitLab account. The token goes into `offtrack login` in their own terminal, never into the conversation.

## Called without arguments

If the user calls it without arguments (`/offtrack`), list the available commands. Run `offtrack help 2>&1` (exit code 2 is expected here). Show the output grouped, with a one-line explanation per group: projects, items, sharing, coworkers, mobile connector, backfill, administration. Add that the common operations ("show the open items", "attach this session to project X") can also be asked for in plain words. Don't run any other command meanwhile.

## Concepts

- **Project:** one or more root directories; everyone sets the roots on their own machine. It has an owner and members; private by default.
- **Thread:** a workflow within the project; every project has a main thread.
- **Milestone** (`stop`): a closed step. **Open branch** (`branch`): unfinished work or a question awaiting a decision. **Manual task** (`manual`): someone has to do it by hand. **Idea** (`idea`): a thought set aside for later, private until its owner publishes it.
- **Alias:** the old name of a merged project; it points to the target project.

## Choosing a thread

The `[offtrack]` block at startup lists the threads. If the work fits one, give its `thread_id` when reporting. If a new multi-step workflow starts, use `offtrack_new_thread`. When in doubt, don't open a new one: report to the main thread (without `thread_id`). If a new thread may have appeared since the block: `offtrack_threads`.

**Open items:** `offtrack_items` (or `offtrack list [<project>]`): the open branches, manual tasks and ideas by thread. Without a project, the session's project. Call it when the user asks for the open items, or when they may have changed since the block.

**Stats:** if the user asks about their own numbers (items, sessions, most active projects), point them to the Your stats page in the web app's main menu: https://offtrack.offsite-solutions.com/stats

**Deadline:** when the user gives a deadline for a task, report it as an open branch or a manual task with `due_date` (`YYYY-MM-DD`). The map and the list show it in a “due: …” line, in red once overdue.

## Picking up a branch

The user pastes a prompt copied from the map that describes an open branch (project, thread, the item's number and text, the latest steps).
1. First summarise the task briefly and wait for the user to confirm.
2. Then: `offtrack_update {item_id, status: "in_progress"}`.
3. When done: `offtrack_update {item_id, status: "done"}`, and if it was a self-contained step, a milestone too.
4. If it turns out not to be needed: `status: "dropped"`, with one sentence on why in your answer.

## Projects, attaching, merging

- **List:** `offtrack_projects` (or `offtrack projects`): name, role (owner/member), the user's roots, members. Always refer to projects by name.
- **Attach:** if the user asks to put this session into a project: `offtrack_attach {project}`. The session's directory, with its subdirectories, joins the project, and later sessions report there too. If a project was created automatically for the directory, it is merged into the target. If the project does not exist, ask whether to create it, and only if they agree: `create: true`.
- **Several machines:** a directory with an unknown path joins the user's existing project through a salted fingerprint of its git remote and the location inside the repo, so a different path needs no attaching. The repo address never reaches the server. A repo with no remote still needs attaching.
- **Root:** `offtrack root <project> <directory>` (Bash): the directory, with its subdirectories, joins the project; the project is created if missing.
- **Display name:** `offtrack rename <project> <name>` (Bash), for example “call madsac MAD/SAC”. An empty name clears it, and the directory name shows again. The main thread's title follows if it still carried the project's old name.
- **Rename a thread:** `offtrack_rename_thread {thread_id, title}` (or `offtrack rename-thread <thread-id> <title>`), the main thread too, only when the user asks. Only the project owner can do it; `offtrack_threads` gives the thread ID.
- **Merge:** `offtrack merge <from> <into>` (Bash). Only the owner of both projects can do it. **It cannot be undone:** first describe what moves over (threads, items, sessions, directories, members) and ask for confirmation.

## Sharing, handing over, publishing, assigning

Only when the user explicitly asks:
- `offtrack share <project> <email>` / `offtrack unshare <project> <email>`: members see everything in the project (except private ideas), can report and can close anyone's items. Only the owner can share.
- `offtrack transfer <project> <email>`: hand ownership to a member; the old owner stays a member.
- `offtrack publish <item-id>` or `offtrack_update {item_id, publish: true}`: make your own idea visible to the members.
- A manual task for someone else: `offtrack_report {kind: "manual", text, assignee: "<email>"}`; the assignee must be a member.

## Handing an item off to another project

If a to-do belongs to another project, don't record a link; hand it off:
- `offtrack_report {kind: "branch" | "manual", text, project, from_item_id?}`: the to-do goes to the target project's main thread. Here `thread_id` is the source thread. `from_item_id` closes your own item at once, and the source thread hears when the target is done. Always give it when the to-do comes from an existing item of yours; without it the item stays open and the link does not start from it.
- Moving an existing item: `offtrack_update {item_id, project}` or `offtrack move <item-id> <project>`. It cannot be combined with `status`.
- You can hand off only to a project the user can see; an unknown project gives `404`, nothing is created. Milestones and ideas cannot be handed off.

## Coworkers

A coworker is a user with a nickname who works on the same repo. You see their nickname and nothing else. A cowork links one of the user's projects with one of the coworker's, at task level (only shared tasks are visible) or project level (every thread and item of the other project, except private ideas). A coworker's items are read-only. Details: https://offtrack.offsite-solutions.com/cowork
- **Nickname:** `offtrack nick [<nickname>]` (Bash); an empty value (`""`) clears it. Set it only when the user asks: it means they agree to be found by coworkers.
- **Who else works on the repo:** `offtrack_coworkers {path?}` (or `offtrack coworkers [<directory>]`). Without `path`, the session's directory; for another repo, give its directory.
- **Hand off to a coworker:** `offtrack_report {kind: "branch" | "manual", text, to: "<nickname>", from_item_id?, repos?}`. The to-do goes to the main thread of the coworker's project as a shared task; `from_item_id` closes your own item, and the source thread hears when the target is done. Always give it when the to-do comes from an existing item of yours. `to` cannot be combined with `project`. You can hand off only to someone who works on one of the task's repos, or whom the project already coworks with.
- **Progress on a shared task:** once you set the user's own shared task to `in_progress`, the session's further reports link to it on their own; sessions of the project's other members don't link. An item received from a coworker carries `[← Neo: #12]`: who sent it, and the source item's id. Explicitly: `offtrack_report {…, parent_item_id}`; it cannot be combined with `project` or `to`.
- **Share without handing off:** `offtrack share-item <item-id> <nickname>` (Bash): the item stays with the user; the coworker can only see it.
- **Coworks,** only when the user asks: `offtrack_cowork {action, nickname?, project?}` (or `offtrack cowork …`). `list`: coworks and pending requests. `request`: ask for project level with the user's own `project`, no common repo needed. `accept` / `decline`: an incoming request; accepting needs `project` when none is suggested. `task`: back to task level. `end`: end the cowork; handed-off tasks stay with the recipient. When a nickname has several project pairs, `project` picks one.

## Repo labels

Every item records which repo it concerns. When reporting, list the directories or files of the repos it concerns in `repos`, for an open branch also the repos the to-do will touch; this matters most when the session works in several repos. If you leave it out, the client works it out from the edited files. Only the repo's fingerprint and root directory name reach the server, never its address.

## Administration (admins only)

- `offtrack admin allow list|add|remove <value>`: the allowlist. A domain (`example.com`): every address in it can sign in; an address (`someone@gmail.com`): only that person.
- `offtrack admin user add <email> <name>`: only with an address on the allowlist.
- `offtrack admin token <email> [label]`: a new client token. **Don't run this yourself:** the token would land in your output and so in the conversation log. Ask the administrator to run it in their own terminal (in Claude Code: `! offtrack admin token <email>`). Users can also generate their own token on the install page (https://offtrack.offsite-solutions.com/install). The token is shown only once; the recipient sets it on their own machine with `offtrack login` (the token comes from standard input).
- `offtrack admin token revoke <email>`, `offtrack admin user disable <email> [--transfer-to <email>]`: when someone leaves. Their shared projects pass to the given member; their private ones are visible to no one.
- The admin cannot see other people's private projects.

## Mobile connector

Items can be added from the Claude app (mobile, desktop, web) with a "track …" request. If the user asks for the connector: `offtrack mobile url` (Bash). The URL is secret, like a password: show it only to the user, and never write it into a file, commit or offtrack item. A new URL invalidates the old one; revoke with `offtrack mobile revoke`.

## Backfill

A proposal file is made per project from old Claude Code conversations (`~/offtrack-backfill/<project>.md`). The user reviews and edits it, then uploads it.

1. `offtrack backfill --dry [--days 60] [--project <name>]`: prints, per project, how many sessions and characters would go into the summary. Show this to the user.
2. `offtrack backfill [--project <name>]` may run only after the user approves: one `claude -p` call per project; it can take long and uses the user's Claude subscription.
3. The user reviews the files, then `offtrack import <file…>`. An uploaded file gets the `.imported` suffix; the server skips items uploaded twice.

## Tokens

Never print a token or copy it into a file, commit, report or offtrack item. If the user pastes a token into the conversation, don't use it: ask them to run `offtrack login` in their own terminal, and suggest having the pasted token revoked (`offtrack admin token revoke <email>`), because it ended up in the conversation log.

## Errors

- **`404`:** it doesn't exist, or the user cannot see it. Don't guess; ask for the exact name, or list.
- **`403`:** visible, but the operation is the owner's.
- **"queued":** the server is unreachable; the report waits locally and is sent on its own. By hand: `offtrack flush`.
- **No session:** the `offtrack` hooks are not installed, or the command doesn't run from a Claude Code session.
