---
name: conference-init
description: Create a new conference build as a separate directory and repository. Use when starting a new conference from the master template. Clones the template to a sibling directory, removes the conference fence, writes .env, and initializes the archive repo. Stops there. The next session is opened in the new directory.
---

# New conference build

The master repo is the **template**. A conference build is its own directory and
its own git repository. It is not a branch.

One directory = one repo = one conference.

## 0. Run this from the master

```bash
git check-ignore brief/ state/ talks/
```

- All three print: this is the template. Continue.
- None print: this is already a build. Stop; do not initialize it again.

The master and the build are different directories. Never run this from inside
an existing build.

## 1. Ask for the build identity

- **Target directory** — default `../<conference-slug>` (a sibling of the master,
  not inside it), e.g. `../2026-10-ai-engineer-nyc`.
- **Slug** — `yyyy-mm-conference-subconference`, all lowercase, hyphenated:
  - `yyyy-mm` — the month the event starts (`2026-10`), not the day.
  - `conference` — the brand as the organizer spells it: `ai-engineer`,
    `ai-native-devcon`, `nvidia-gtc`.
  - `subconference` — the edition: a named event (`code-summit`) or the city of
    a regional edition (`nyc`, `miami`, `san-jose`). Omit it only when the
    brand has a single edition.

  Examples: `2026-10-ai-engineer-nyc`, `2026-11-ai-engineer-code-summit`,
  `2026-11-ai-native-devcon-nyc`, `2026-03-nvidia-gtc-san-jose`.
- **Conference URL** — the schedule page. Never invent it.
- **Repository** — default `<owner>/<conference-slug>`, private unless the user
  says public, e.g. `The-Focus-AI/2026-10-ai-engineer-nyc`.

## 2. Clone the template to the new directory

```bash
git clone <template-url> <target-dir>
cd <target-dir>
git remote rename origin template
```

Use the master's `origin` URL. If the master has no remote, use its absolute
path as the clone source and skip the GitHub steps.

Do not copy the master's `.env`, `dist/`, `runs/`, raw media, or node_modules.

## 3. Remove the conference fence

`.gitignore` has:

```text
# BEGIN conference build data
…
# END conference build data
```

Delete the whole block. This is the mode change: this repo now tracks its own
`brief/`, `state/`, `talks/`, `recordings/inbox/`, `photos/`, `analysis/`,
`editorial/`, `explainers/<slug>/`, `atlases/<slug>/`, and `magazine/<issue>/`.

Do **not** delete the rest of `.gitignore`. `dist/`, `runs/`, `.env`, raw audio,
raw photos, and package caches stay ignored in every build.

## 4. Write `.env`

```bash
cp .env.example .env
```

Set `CONFERENCE_URL` to the URL the user gave. Leave the other lines as in the
example. `.env` stays uncommitted.

## 5. Create the archive repository

```bash
gh repo create <owner>/<conference-slug> --private --source=. --remote=origin
git add .gitignore
git commit -m "conference: initialize <name>"
git push -u origin main
git remote remove template
```

If the user does not want a remote yet, commit locally. The directory is still
a separate repo. Its `origin` is its own archive, not the master.

## 6. Stop

This skill is done when:

- the target directory exists and is its own git repository
- the conference fence is gone from its `.gitignore`
- its `.env` sets `CONFERENCE_URL`
- `origin` is the new archive, or the commit is local because the user declined a remote

Tell the user the directory path. The next step is a new session opened in that
directory. This session ends here. Schedule rendering, `prose compile`, and
`prose serve` are that later session's work.

## Boundaries

- No branches for builds. A branch in the master is not an archive.
- Never initialize a second conference in an existing build; clone again.
- Do not copy another conference's build into the new directory.
- Do not delete `.gitignore`; delete only the marked block.
- If a step fails, stop and report which step failed. Leave the directory as it is.
