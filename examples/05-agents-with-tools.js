// ─────────────────────────────────────────────────────────────────────────────
//  Example 05 · agents with tools — they don't just write, they ACT
//
//  Teaches: the power unlock most people miss — subagents carry a full tool
//           belt (read files, run commands, search). The SCRIPT is sandboxed;
//           its AGENTS are not. This example maps the current repo with no
//           file contents ever passing through the script.
//  Agents spawned: 1 scout + up to 8 readers + 1 cartographer
//  Run this FROM a repo directory (this one works):
//       "Run the workflow at examples/05-agents-with-tools.js"
// ─────────────────────────────────────────────────────────────────────────────
//
//  WHAT the division of power is: workflow scripts run in a sandbox — no
//  filesystem, no network, no Node APIs. So how does a workflow ever touch
//  the world? Through its agents. Every subagent is a real Claude Code
//  agent with tools: it can Read files, Grep, run Bash, fetch the web. The
//  sandbox applies to the CONDUCTOR, never to the MUSICIANS.
//
//  WHY this composes so well with schemas: an agent that can act + a schema
//  that shapes what it reports = a probe you can aim anywhere and get DATA
//  back. That pair (tools in, structure out) is the workhorse of serious
//  orchestration: repo audits, log trawls, migration sweeps, fact-checking.
//
//  GOTCHA: agents run in the session's working directory. This script
//  assumes it's launched from a repo checkout — the scout is told to look
//  around "the current working directory" and will report whatever repo
//  you're actually in.

export const meta = {
  name: 'ex05-agents-with-tools',
  description: 'Scout lists the repo, readers each study one file, a cartographer draws the map',
  phases: [{ title: 'Scout' }, { title: 'Read' }, { title: 'Map' }],
}

const MAX_FILES = 8   // keep the demo fleet small; see the no-silent-caps log below

//  Stage 1 — THE SCOUT: one agent, tools required. The script cannot run
//  `ls`, but the scout can. Note the schema: exploration in, file list out.
log('Scout: discovering files with its own tools')
const recon = await agent(
  `Explore the CURRENT WORKING DIRECTORY (it is a git repository) using your tools ` +
  `(e.g. Bash ls, Glob). List every regular file in the repo root and any ` +
  `subdirectories, EXCLUDING the .git directory, dotfiles, and anything you did not ` +
  `actually observe. Paths must be relative to the repo root. Also note the repo's ` +
  `apparent purpose in one sentence (from README or file names).`,
  {
    label: 'scout', phase: 'Scout',
    schema: {
      type: 'object',
      properties: {
        purpose: { type: 'string', description: 'one sentence: what this repo appears to be' },
        files: { type: 'array', items: { type: 'string' }, description: 'relative paths you verified exist' },
      },
      required: ['purpose', 'files'],
    },
  }
)

if (!recon || !recon.files?.length) {
  return { error: 'scout failed or found no files — is the workflow running inside a repo?' }
}

//  NO SILENT CAPS: if a workflow bounds its coverage (top-N, sampling),
//  say so out loud. A truncated result that doesn't announce the truncation
//  reads as "covered everything" — the most expensive kind of wrong.
const files = recon.files.slice(0, MAX_FILES)
if (recon.files.length > files.length) {
  log(`capping fleet: reading ${files.length} of ${recon.files.length} files — skipped: ${recon.files.slice(MAX_FILES).join(', ')}`)
}

//  Stage 2 — THE READERS: one agent per file, pipelined (Example 04), each
//  using its OWN tools to read its OWN file. The script never sees file
//  contents — only the structured verdicts. This is also the memory trick:
//  ten files' contents would flood one context window; ten agents give you
//  ten fresh windows and hand back only conclusions.
const dossiers = await pipeline(
  files,
  (path) => agent(
    `Read the file "${path}" in the current working directory with your tools. ` +
    `Report on it honestly — if it is long, skim structure first, then key parts.`,
    {
      label: `read:${path}`, phase: 'Read', model: 'haiku',
      schema: {
        type: 'object',
        properties: {
          role: { type: 'string', description: 'this file\'s job in the repo, 1-2 sentences' },
          keyDetail: { type: 'string', description: 'the single most interesting or load-bearing thing inside it' },
          lines: { type: 'number', description: 'its line count (wc -l or equivalent)' },
        },
        required: ['role', 'keyDetail', 'lines'],
      },
    }
  ).then(d => d && { path, ...d })
)

const found = dossiers.filter(Boolean)
if (!found.length) {
  return { error: 'every reader agent failed', scouted: files }
}

//  Stage 3 — THE CARTOGRAPHER: strong model (no override → inherits the
//  session model), barrier legitimate (a map needs all the dossiers).
log(`Map: synthesizing ${found.length} dossiers`)
const map = await agent(
  `You are writing a newcomer's orientation to a repository.\n` +
  `Repo purpose (per a scout): ${recon.purpose}\n\n` +
  `Below are per-file dossiers from agents who each read one file. Write a short ` +
  `orientation: what this repo is, how the files relate (which is the entry point, ` +
  `which is documentation, which is machinery), and where a newcomer should start ` +
  `reading and why. Your final message must be the orientation only.\n\n` +
  found.map(d => `--- ${d.path} (${d.lines} lines) ---\nrole: ${d.role}\nkey detail: ${d.keyDetail}`).join('\n\n'),
  { label: 'cartographer', phase: 'Map' }
)

return {
  purpose: recon.purpose,
  filesRead: found.map(d => d.path),
  skipped: recon.files.slice(MAX_FILES),
  dossiers: found,
  orientation: map ?? '(cartographer failed — dossiers above still stand)',
}

//  TRY: run this from a DIFFERENT repo (cd there first, then ask Claude to
//  run this script by absolute path). Nothing in the script changes — the
//  agents explore whatever world they wake up in. That's the tell that the
//  power lives in the agents, not the script.
