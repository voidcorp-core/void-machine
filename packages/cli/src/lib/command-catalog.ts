// Shared by dispatch, help and discovery. Adding a command requires a typed handler.
export const COMMAND_CATALOG = {
  "init": {
    "aliases": [],
    "help": [
      {
        "signature": "init [--pack] [--runtime]",
        "description": "Install bundled local assets by default: detect runtimes + stack, activate packs, write doctrine. --runtime claude|codex|both, --source marketplace, --force."
      }
    ]
  },
  "runtime": {
    "aliases": [],
    "help": [
      {
        "signature": "runtime <list|add <r>>",
        "description": "Show which runtimes are wired, or add one (claude|codex) a posteriori without a reinstall \u2014 touches only that runtime."
      }
    ]
  },
  "add": {
    "aliases": [],
    "help": [
      {
        "signature": "add <pack>",
        "description": "Activate a stack pack in the current project."
      }
    ]
  },
  "remove": {
    "aliases": [
      "rm"
    ],
    "help": [
      {
        "signature": "remove <pack>",
        "description": "Deactivate a pack (core cannot be removed)."
      }
    ]
  },
  "list": {
    "aliases": [
      "ls"
    ],
    "help": [
      {
        "signature": "list",
        "description": "Show active and available packs."
      }
    ]
  },
  "status": {
    "aliases": [],
    "help": [
      {
        "signature": "status",
        "description": "Project health: the five-state capability lifecycle + a score. Deterministic, offline, no LLM."
      }
    ]
  },
  "doctor": {
    "aliases": [],
    "help": [
      {
        "signature": "doctor [--no-remote] [--fix]",
        "description": "Health-check the install (config, doctrine, per-runtime wiring), and report structural drift from the conventions the harness declares. --fix repairs the mechanical ones, refused on a dirty tree, never committed. --dry-run shows the mutations."
      }
    ]
  },
  "update": {
    "aliases": [],
    "help": [
      {
        "signature": "update [--dry-run] [--untrack-derived]",
        "description": "Recompile local receipt-owned assets from this CLI; migrate the .void layout and retire the obsolete project-pointer registry in bounded batches. --untrack-derived drops regenerated files from the git index, keeping them on disk."
      }
    ]
  },
  "hydrate": {
    "aliases": [],
    "help": [
      {
        "signature": "hydrate",
        "description": "Restore this project's harness assets from .void/install-manifest.json and prove every file against its hash. Refuses to run on a different version."
      }
    ]
  },
  "check": {
    "aliases": [],
    "help": [
      {
        "signature": "check [--doctrine]",
        "description": "Report local vs remote version drift. --doctrine also diffs PHILOSOPHY.md."
      }
    ]
  },
  "graph": {
    "aliases": [],
    "help": [
      {
        "signature": "graph <sub>",
        "description": "Build / gate / report the skill-agent graph (build, check, audit, live, behavior)."
      },
      {
        "signature": "graph <query> <file>",
        "description": "Ask this project's graph: explain \u00b7 path \u00b7 impact \u00b7 subgraph \u00b7 owners \u00b7 tests-for \u00b7 staleness. Bounded (--max-nodes/--max-depth), read-only, and explicit when the answer may be incomplete."
      },
      {
        "signature": "graph project-build|project-check",
        "description": "Generate .void/knowledge.json or verify its freshness against a new ProjectGraph build."
      }
    ]
  },
  "why": {
    "aliases": [],
    "help": [{ "signature": "why <file>", "description": "Explain declared decisions, invariants and verification references with provenance; report incomplete knowledge and dangling references." }]
  },
  "autopilot": {
    "aliases": [],
    "help": [
      {
        "signature": "autopilot [sub]",
        "description": "The kernel of the continuous delivery loop: next \u00b7 stop \u00b7 arm \u00b7 disarm \u00b7 fingerprint \u00b7 judgment; --json for the skill. Reads .void/program.md, the tracker on stdin and GitHub; decides, and acts only to arm and disarm."
      }
    ]
  },
  "audit": {
    "aliases": [],
    "help": [
      {
        "signature": "audit",
        "description": "Self-evolution audit: surface stale / never-fired skills as deprecation candidates. HITL."
      }
    ]
  },
  "projects": {
    "aliases": [],
    "help": [
      {
        "signature": "projects",
        "description": "Every Void project on this machine and where attention is owed. Offline projection, never writes; --json for a served view."
      }
    ]
  },
  "resume": {
    "aliases": [],
    "help": [
      {
        "signature": "resume",
        "description": "Pick this project back up: the session checkpoint, recent decisions, and what is NOT answered. Reads, never guesses."
      }
    ]
  },
  "ui": {
    "aliases": [],
    "help": [
      {
        "signature": "ui",
        "description": "Serve the projects view on localhost, read per request. Loopback only, one-shot token, stops with the command."
      }
    ]
  },
  "adoption": {
    "aliases": [],
    "help": [
      {
        "signature": "adoption",
        "description": "Maintainer: pull public npm + GitHub stats (tier-1 telemetry, zero phone-home)."
      }
    ]
  },
  "decisions": {
    "aliases": [],
    "help": [
      {
        "signature": "decisions <sub>",
        "description": "Create, validate, or render one-file ADRs without a shared counter or index."
      }
    ]
  },
  "mission": {
    "aliases": [],
    "help": [
      {
        "signature": "mission <sub>",
        "description": "Plan a deterministic DAG, then start, resume, verify, inspect, archive, or explicitly prune an auditable local mission run."
      }
    ]
  },
  "agents": {
    "aliases": [],
    "help": [
      {
        "signature": "agents <sub>",
        "description": "Delegate to an agent through the kernel: dispatch a Claude background session, wait for its next transition, read its status and result, send, accept, stop or attach it."
      }
    ]
  },
  "security": {
    "aliases": [],
    "help": [
      {
        "signature": "security <adapters|scan>",
        "description": "Run the local security baseline over whatever scanners are installed. A target is refused without an explicit, unexpired authorization naming its host."
      }
    ]
  },
  "self-host": {
    "aliases": [],
    "help": [
      {
        "signature": "self-host <sync|doctor>",
        "description": "Maintainer: compile current sources into an isolated dogfood artifact and verify source, hooks, events, replay, and runtime availability."
      }
    ]
  },
  "install": {
    "aliases": [],
    "help": [
      {
        "signature": "install [--global] [--dry-run]",
        "description": "Install the bundled Claude plugin at user-global scope; init is the project installation entry point."
      }
    ]
  },
  "cheatsheet": {
    "aliases": [],
    "help": [
      {
        "signature": "cheatsheet [--format html|markdown|json]",
        "description": "Discover the shipped catalogue and local availability. Offline document on stdout; HTML by default."
      }
    ]
  },
  "version": {
    "aliases": [
      "--version",
      "-v"
    ],
    "help": [
      {
        "signature": "version",
        "description": "Print the CLI version (also -v)."
      }
    ]
  },
  "help": {
    "aliases": [
      "--help",
      "-h"
    ],
    "help": [
      {
        "signature": "help",
        "description": "Print this command reference (also -h)."
      }
    ]
  }
} as const;

export type CommandName = keyof typeof COMMAND_CATALOG;

function isCommandName(input: string): input is CommandName {
  return Object.hasOwn(COMMAND_CATALOG, input);
}

export function commandName(input: string | undefined): CommandName | undefined {
  if (input === undefined) return "help";
  if (isCommandName(input)) return input;
  for (const [name, command] of Object.entries(COMMAND_CATALOG)) {
    if (isCommandName(name) && command.aliases.some(alias => alias === input)) return name;
  }
  return undefined;
}
