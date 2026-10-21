# Changelog

## [5.0.4](https://github.com/voidcorp-core/void-machine/compare/v5.0.3...v5.0.4) (2026-10-21)


### Bug Fixes

* **ci:** declare existing integration coverage ([55805f6](https://github.com/voidcorp-core/void-machine/commit/55805f62a900c0573ff88b809bf98c578a99a02b))
* **ci:** defer draft integration with explicit admission ([6969129](https://github.com/voidcorp-core/void-machine/commit/696912961f9f21047310aa1cc52c3947863c0808))
* **ci:** reuse development drafts for review handoff ([b0c54f7](https://github.com/voidcorp-core/void-machine/commit/b0c54f70cd4627011581d9509a58c8353355344b))
* **mission:** count fresh independent provenance as recovery progress ([895f8f6](https://github.com/voidcorp-core/void-machine/commit/895f8f69872ee359d4476481a30a01785cc83114))
* **mission:** preserve review identity through stop and recovery ([169092e](https://github.com/voidcorp-core/void-machine/commit/169092eba2cfd27927e7ecf60451c9739e0179ee))
* **orchestrate:** discover worker host before first mission ([aecf1a8](https://github.com/voidcorp-core/void-machine/commit/aecf1a88da8ed41bebdf6a23b5046117f6694061))
* preserve mission continuity and streamline development feedback ([29e35a0](https://github.com/voidcorp-core/void-machine/commit/29e35a051aaae0a5309830cb702a25e80f914933))
* **review:** bound generated patch capture separately ([6689749](https://github.com/voidcorp-core/void-machine/commit/6689749e342f665aa53e336eadfc627f44a4a6dc))

## [5.0.3](https://github.com/voidcorp-core/void-machine/compare/v5.0.2...v5.0.3) (2026-10-17)


### Bug Fixes

* **mission:** recover reused preparation review contexts without resetting budgets ([4c581be](https://github.com/voidcorp-core/void-machine/commit/4c581be69e313701320bd53f884faa288033dc55))
* **mission:** replace reused preparation invocations without resetting budgets ([c488918](https://github.com/voidcorp-core/void-machine/commit/c488918dfd9e29a1619d89c603c57b8f82718e25))

## [5.0.2](https://github.com/voidcorp-core/void-machine/compare/v5.0.1...v5.0.2) (2026-10-14)


### Bug Fixes

* **hooks:** detect camelCase credential assignments in source ([c965b2a](https://github.com/voidcorp-core/void-machine/commit/c965b2ae5b052676787c871e225a70826019631e))
* **hooks:** distinguish credential source modules from value files ([950d369](https://github.com/voidcorp-core/void-machine/commit/950d369197a61f0eee1d01946e38693fbeb724a2))
* **hooks:** distinguish credential source modules from value files ([cff0b26](https://github.com/voidcorp-core/void-machine/commit/cff0b2628bdd8174c2787b6749ac3cab15eda286))
* **hooks:** evaluate credential literals independently ([e32a016](https://github.com/voidcorp-core/void-machine/commit/e32a0166051ca4f55336809254130e1973daefb1))

## [5.0.1](https://github.com/voidcorp-core/void-machine/compare/v5.0.0...v5.0.1) (2026-10-13)


### Bug Fixes

* **hooks:** distinguish source tests from credential filenames ([f6fdf6a](https://github.com/voidcorp-core/void-machine/commit/f6fdf6a0ec89eb9861bad6dd6a584756307a48be))
* **hooks:** distinguish source tests from credential filenames ([2bceecc](https://github.com/voidcorp-core/void-machine/commit/2bceecc0df659384030dee9a13da7be131c92e30))
* **hooks:** refuse credential test shell writes without content ([bddebce](https://github.com/voidcorp-core/void-machine/commit/bddebce03bd92a94ecb29cf4d68900e3fe94f1fa))
* **hooks:** retain content checks for credential-named source tests ([a9fbef2](https://github.com/voidcorp-core/void-machine/commit/a9fbef25685d7466522f3fb98a1d531a96c0ce3f))

## [5.0.0](https://github.com/voidcorp-core/void-machine/compare/v4.0.0...v5.0.0) (2026-10-13)


### ⚠ BREAKING CHANGES

* **autopilot:** `autopilot.mergeGate` no longer exists and the programme declares `autopilot.schemaVersion: 2`. A 4.0 programme is refused by the loop until migrated: run `void-machine autopilot merges --by-human` first to keep every merge yours, then remove `mergeGate` and set the schema to 2. The loop no longer requires a protected base.

### Features

* **autopilot:** decide the merge on a local verdict bound to the head SHA ([e4c0e0a](https://github.com/voidcorp-core/void-machine/commit/e4c0e0adf21a7d1393740d43cf65e8d6b52c945e))
* **autopilot:** delegate the independent review and record its verdict locally ([6145735](https://github.com/voidcorp-core/void-machine/commit/61457359714306364322578a46b969ea0b8f0def))
* **autopilot:** protect the new judging chain from the loop that runs it ([338fbe6](https://github.com/voidcorp-core/void-machine/commit/338fbe6f43fac7f7c64f1582503057aa5bc5e7f5))
* **autopilot:** protect the new judging chain from the loop that runs it ([2f714cf](https://github.com/voidcorp-core/void-machine/commit/2f714cf2bd8537a9dc7b16db2a827bc5dff2c146))
* **autopilot:** replace mergeGate with one merge mode and an explicit human hold ([dd0ce92](https://github.com/voidcorp-core/void-machine/commit/dd0ce92fb2eba54afa3ea397bd6e4ebc07b9fc97))
* **cli:** expose agents dispatch, wait, status, send, accept, stop and attach ([88c0dcd](https://github.com/voidcorp-core/void-machine/commit/88c0dcdf1cc8874de7db7ff08775101c39aec61d))
* **delegation:** accept a review result only from the session the runtime lists ([4f75f0d](https://github.com/voidcorp-core/void-machine/commit/4f75f0d9ba17c8eb57a81461e4685ba578e68929))
* **delegation:** accept a review result only from the session the runtime lists ([88586e8](https://github.com/voidcorp-core/void-machine/commit/88586e86998b9f3771f9cbb95ea848d60f20134c))
* **hooks:** capture the Agent tool into a supervised run ([5335320](https://github.com/voidcorp-core/void-machine/commit/5335320e28e1cc83c405766351b3c24e681f993f))
* **hooks:** capture the Agent tool into a supervised run ([951f927](https://github.com/voidcorp-core/void-machine/commit/951f9278684bc9cd5eda169c7b0e2689a74f2de2))
* **hooks:** record a delegated run's final message on Stop ([296e4fa](https://github.com/voidcorp-core/void-machine/commit/296e4faedaf403d54a5ce6f6034fed4825cb1ff0))
* **orchestra:** explicitly select coordinator mission (DEV-1017) ([446691b](https://github.com/voidcorp-core/void-machine/commit/446691befd3cb2a376b7884c4c32ac772aa06c94))
* **orchestra:** select context without rewriting mission history ([e44abe2](https://github.com/voidcorp-core/void-machine/commit/e44abe26a5c4c3b07d9bcef9f33fcb2397904a96))
* **orchestration:** delegate adaptive work through native agents ([757131c](https://github.com/voidcorp-core/void-machine/commit/757131cb4fcd24c231d1580ea658272a0c383448))
* **orchestration:** make native delegation adaptive ([2ad72f8](https://github.com/voidcorp-core/void-machine/commit/2ad72f8acb920b3f3ce8b9097000422cab7f35f4))
* **orchestration:** native Herdr missions and independent review continuity (DEV-1016) ([c7b8634](https://github.com/voidcorp-core/void-machine/commit/c7b86348fe4d2816561745233c1dee8f6087a71d))
* **orchestration:** preserve native mission identity and review evidence ([6b42cc7](https://github.com/voidcorp-core/void-machine/commit/6b42cc7a987ec62eb4c43bc89f9704ddeee41f69))
* **orchestration:** use the validated session host ([e299728](https://github.com/voidcorp-core/void-machine/commit/e299728e8a4de3e9e96c49fc129881af6a8f1462))
* **security:** allow explicitly scoped credential orchestration ([f623211](https://github.com/voidcorp-core/void-machine/commit/f6232117f92c7d1fc28694a9bdb8a08c3cb12c3b))
* **security:** permit explicitly scoped credential orchestration ([8fb526d](https://github.com/voidcorp-core/void-machine/commit/8fb526d763de0ffa3554619edd30a0cf24fbf433))
* **void-machine:** admit, track and reconcile delegated agent runs ([2dc871f](https://github.com/voidcorp-core/void-machine/commit/2dc871fe7b4a07f553a175cefbb8f51c1672eb7c))
* **void-machine:** deliver the kernel's agent delegation with the Claude adapter ([c5ebbf6](https://github.com/voidcorp-core/void-machine/commit/c5ebbf6c26973f1b34dbcdc06d1506f4eb38f5a7))
* **void-machine:** record delegated runs and compose the agents commands ([55a5a4d](https://github.com/voidcorp-core/void-machine/commit/55a5a4dfe7dfed82d110170a8fab33c8f8ff87d0))
* **void-machine:** run delegated agents as Claude background sessions ([3ce1382](https://github.com/voidcorp-core/void-machine/commit/3ce13827e2f0b15d1bd007fcdb71588843c9d760))
* **void-machine:** run delegated agents as threads of the Codex daemon ([f55c4bd](https://github.com/voidcorp-core/void-machine/commit/f55c4bda116724e126b53fb762651e947c1e61c2))
* **void-machine:** run delegated agents as threads of the Codex daemon ([6d7ca03](https://github.com/voidcorp-core/void-machine/commit/6d7ca031980220ef582b12cb0f4cf3e32d6fd49c))
* **void-machine:** show delegated runs in herdr, tmux or cmux surfaces ([972b517](https://github.com/voidcorp-core/void-machine/commit/972b517ff05d389e5a3c535ed606808822766228))
* **void-machine:** show delegated runs in herdr, tmux or cmux surfaces ([3c8cebb](https://github.com/voidcorp-core/void-machine/commit/3c8cebb3edf4790b6819a4e049079c20818b2e73))


### Bug Fixes

* align native context validation so authentic preparation receipts survive dispatch ([6e21f6e](https://github.com/voidcorp-core/void-machine/commit/6e21f6ea90f5bec07d5c56864cbbe04d9fb81998))
* **autopilot:** hand a human-gated pull request over without the review check ([3f0b3a8](https://github.com/voidcorp-core/void-machine/commit/3f0b3a8c2c7f2baeb5fdcaa0575c04e827a0b82f))
* **autopilot:** hand a human-gated pull request over without the review check ([ff56875](https://github.com/voidcorp-core/void-machine/commit/ff568756685aa56bd0033cf915e810b43f8acd79))
* **autopilot:** never run a head's reviewer configuration, and bound a resumed review ([9e21299](https://github.com/voidcorp-core/void-machine/commit/9e21299b6bc8293869a3a86161cf4a07a7c9e1e4))
* **autopilot:** one review per head, a final verdict, and a counted round ([8e7a7e1](https://github.com/voidcorp-core/void-machine/commit/8e7a7e1f13a6b472717b8e20a0caabc3711439ec))
* **autopilot:** prove the checks and the verdict where the merge happens ([0bb8815](https://github.com/voidcorp-core/void-machine/commit/0bb88157994c68254211812fc4b1a89884a02bc4))
* **autopilot:** refuse a review outside a programme instead of naming a file ([95ec9bf](https://github.com/voidcorp-core/void-machine/commit/95ec9bf2428431ae19d57f9818fae2a42477c213))
* **autopilot:** retain unresolved native review blockers ([f8ea02f](https://github.com/voidcorp-core/void-machine/commit/f8ea02fcaf792df05585d74f6112e2918830ae15))
* **cli:** compile Codex hook commands without a machine path ([e162b00](https://github.com/voidcorp-core/void-machine/commit/e162b00b6311ac07adc39afea2fb89c049fd1203))
* **cli:** resolve the Codex hook runner from any checkout, in any shell ([1757211](https://github.com/voidcorp-core/void-machine/commit/1757211350b9a693198b366d00ab6af790913d13))
* **conformance:** isolate latency from the install process budget ([02adc8a](https://github.com/voidcorp-core/void-machine/commit/02adc8a9c8720aa7c05b5421328940100185e72e))
* **conformance:** keep temporary names outside the skill namespace ([d9fb3c1](https://github.com/voidcorp-core/void-machine/commit/d9fb3c13c000e3efa49e66aeca4a3453a205a669))
* **conformance:** prove the installed worker, observe its latency ([c6f16e1](https://github.com/voidcorp-core/void-machine/commit/c6f16e19c303fc94fedb742187508bc1706cd386))
* **delegation:** accept the result hook wired by an installed plugin ([ed33dde](https://github.com/voidcorp-core/void-machine/commit/ed33dde1a0258c466e5078109a225d86b1d83ae9))
* **delegation:** verify the review session in the same step that takes the result ([acb007a](https://github.com/voidcorp-core/void-machine/commit/acb007a3d0d3ef4d90a2f914ba7b619005d137d5))
* **herdr:** guard native Codex session ownership ([212eae6](https://github.com/voidcorp-core/void-machine/commit/212eae664b38d17755a7274e2cc0aa46116e590b))
* **herdr:** prove ancestry before relaying native sessions ([4f9f5b9](https://github.com/voidcorp-core/void-machine/commit/4f9f5b967cfcc82f38a43514ec28314391b321cc))
* **hook-runner:** refuse Codex tool calls with a denial every shell carries ([03580e2](https://github.com/voidcorp-core/void-machine/commit/03580e2d0609d1d98bc5ef06d80512327b811c60))
* **hooks:** allow edits to co-owned project files ([db0e4c8](https://github.com/voidcorp-core/void-machine/commit/db0e4c8fca308e888050ebb87a6b2deeca39c048))
* **hooks:** give a foreground wait the Bash timeout it needs ([a5d9777](https://github.com/voidcorp-core/void-machine/commit/a5d977792a54f2ddb6bf93ecdf5dc9986c539c7e))
* **hooks:** name the npx package through the product identity ([056c04d](https://github.com/voidcorp-core/void-machine/commit/056c04def54bbb2d8832cab1c4886d0336d3a5bf))
* **hooks:** park a result only for a recent run in the session's directory ([69d288e](https://github.com/voidcorp-core/void-machine/commit/69d288eac8c4a7b7937ee41e18fdab43798ae498))
* **hooks:** preserve edits to co-owned project files ([d40bd6a](https://github.com/voidcorp-core/void-machine/commit/d40bd6aa6a4d2223dee880f00557d4aadbfd9e6c))
* **implement:** brief the whole envelope, follow the run, resume before dispatch ([0ba83ad](https://github.com/voidcorp-core/void-machine/commit/0ba83ade0989ee2559a977814f5b467392f04a60))
* **implement:** take a result already accepted from the run that holds it ([8730ef4](https://github.com/voidcorp-core/void-machine/commit/8730ef43d6b75803e3fcffb76335703825ba1a55))
* **init:** materialize retained packs during reconciliation ([847edd0](https://github.com/voidcorp-core/void-machine/commit/847edd01d44cd54ae3f94c67430048036b817909))
* **init:** materialize retained packs when reconciling runtimes ([50e27d1](https://github.com/voidcorp-core/void-machine/commit/50e27d192a63d232a5513326e7581d94e05af232))
* **invocation:** distinguish Codex observability from skill silence ([8fee97c](https://github.com/voidcorp-core/void-machine/commit/8fee97c9ba8ab7ad17c24a45204dd849f54acf24))
* **invocation:** preserve runtime observability in skill health ([cc395ba](https://github.com/voidcorp-core/void-machine/commit/cc395ba6856ed0200bd538cc8e4227a98550cbd2))
* **invocation:** share the bounded corpus with doctor ([9703639](https://github.com/voidcorp-core/void-machine/commit/9703639bbac71312f8def99f934a486a8b28912d))
* **mission:** admit authenticated command evidence corrections ([8aff216](https://github.com/voidcorp-core/void-machine/commit/8aff2163901c74ca1dbee27e73e964fbef740da0))
* **mission:** bound clarification recovery to one no-progress exception ([8c51c08](https://github.com/voidcorp-core/void-machine/commit/8c51c086ddc5bdd1698227618800c9371935bfb7))
* **mission:** keep preparation evidence waits recoverable ([2e1c943](https://github.com/voidcorp-core/void-machine/commit/2e1c943dd7c64153ba2d3bcb057ed8ddd19f1c8f))
* **mission:** preserve evidence waits and recover corrected commands ([96ff24b](https://github.com/voidcorp-core/void-machine/commit/96ff24b37f1aadb035feb8cc2e13555f47f18c4a))
* **mission:** preserve opaque native contexts through review recovery ([c2d17c0](https://github.com/voidcorp-core/void-machine/commit/c2d17c0bdc3fea90f711f4ad223864ba5e380f8e))
* **mission:** require independent review before bounded completion ([610df3c](https://github.com/voidcorp-core/void-machine/commit/610df3c21684876532d7c8e6e39027c78fc969c3))
* **mission:** require independent review for every bounded implementation ([6a4a73e](https://github.com/voidcorp-core/void-machine/commit/6a4a73e96a65a1c3a3fe94464b6dc32c3b494288))
* **release:** allow measured npm propagation without bypassing provenance ([de40f0a](https://github.com/voidcorp-core/void-machine/commit/de40f0ab9e4b3e8020ccd9ae462d6330857a233e))
* **release:** defer back-merge while its pull request is queued ([cc62066](https://github.com/voidcorp-core/void-machine/commit/cc620662229a329186861787cbd46febba13464a))
* **release:** preserve the back-merge head while it is queued ([f17147e](https://github.com/voidcorp-core/void-machine/commit/f17147e5f6d4c1f789310ecabe398083f47f5b1e))
* **release:** wait for measured npm registry convergence ([cd4bd44](https://github.com/voidcorp-core/void-machine/commit/cd4bd44e37ca98240fc19c20d097e0bbe06baaba))
* require the bound preparation panel so missing specialists cannot recover ([938a5fa](https://github.com/voidcorp-core/void-machine/commit/938a5fa5da607b617140dc3b8f274bfe12db60d7))
* share native context validation so evidence receipts preserve opaque identity ([1e2e860](https://github.com/voidcorp-core/void-machine/commit/1e2e860d35dbe0f46e6b2ad2155efad5c93ddf5d))
* **skills:** route delivery through supervised delegation ([bc1722c](https://github.com/voidcorp-core/void-machine/commit/bc1722cb1dc5cf3487b26804b9117b966620eea2))
* **testing:** bound fixtures by the proof they own ([20d44d0](https://github.com/voidcorp-core/void-machine/commit/20d44d09e12787d5127523f995ef1e0630712d6f))
* **void-machine:** adopt a copy's parked answer and keep the kernel brand-free ([93ff956](https://github.com/voidcorp-core/void-machine/commit/93ff9567a8f808534cba83283ae33f4cd842ef9f))
* **void-machine:** compare the cmux socket before refusing to close the caller ([a491109](https://github.com/voidcorp-core/void-machine/commit/a491109412a7e017a4a77c9df00915128686f5cf))
* **void-machine:** end a delegated turn on its final Stop result ([9364a8e](https://github.com/voidcorp-core/void-machine/commit/9364a8e74384344324b30ca2aecc6d641ba4e544))
* **void-machine:** end Claude options before the delegated prompt ([987265b](https://github.com/voidcorp-core/void-machine/commit/987265bbcffd9c7299947d323e317af826e6c90c))
* **void-machine:** end the turn of an agent that ends it with a question ([3dfbc0e](https://github.com/voidcorp-core/void-machine/commit/3dfbc0ef3f54db5193e774c4725c3c81bf679c20))
* **void-machine:** follow a delegated session resumed as a copy ([56a2c07](https://github.com/voidcorp-core/void-machine/commit/56a2c079f08e9ebc8ac6719a13892122e815fdd9))
* **void-machine:** keep the view of a run that failed while its surface opened ([87ff4b9](https://github.com/voidcorp-core/void-machine/commit/87ff4b9965165d7c53f07e67e460bb0a037627c9))
* **void-machine:** recount the crew tab after a pane closed by hand ([af8735c](https://github.com/voidcorp-core/void-machine/commit/af8735c9de9b87d81abf72502d63356ee1d58ae7))
* **void-machine:** settle the surface record when the mission stays busy ([086dc6e](https://github.com/voidcorp-core/void-machine/commit/086dc6ef36dff9810d735cd67bab3861332ac17d))

## [4.0.0](https://github.com/voidcorp-core/void-machine/compare/v3.8.0...v4.0.0) (2026-09-25)


### ⚠ BREAKING CHANGES

* the npm package is voidmachine and the vh command is removed; void-harness remains as a deprecated alias. The first release under the new name must be a major (4.0.0), which packageFor relies on to tell voidharness releases from voidmachine ones.
* **review:** the repository needs the review App, the variables REVIEW_APP_CLIENT_ID and REVIEW_APP_ID, the environment secret REVIEW_APP_PRIVATE_KEY, and the required check pinned to that App.
* **autopilot:** `void-harness autopilot review-key` and `verdict` are removed; the loop believes only the review job's check and comment.
* **review:** the review is no longer posted from the orchestration checkout; the repository needs a CLAUDE_CODE_OAUTH_TOKEN secret.
* **autopilot:** the cluster subcommands of `void-harness autopilot` are removed; a programme's `chainBudget` is no longer read.
* **hooks:** the review-verdict-write hook is no longer installed; a consumer relying on it for hand-written verdicts relies on the signed verdict check instead.
* **cli:** the voidharness package no longer installs a void-machine executable and VOID_MACHINE_BIN is no longer read. Use void-harness doctor. Reinstalling voidharness@3.8.0 restores the launcher; it wrote no data, so nothing needs migrating either way.
* **engines:** voidharness, @voidcorp/harness-graph, @voidcorp/pack-monorepo and @voidcorp/pack-nextjs now declare engines.node >=24.15.0. On Node 22 npm warns at install, and a consumer with engine-strict=true can no longer install; upgrade to Node 24 LTS or later.
* **worktrees:** autopilot orchestrate requires schemaVersion 2 observations and returns absolute worktree paths. Legacy inputs are explicitly refused; post-merge cleanup requires a fresh request with ticket-specific evidence.

### Features

* **autopilot:** continuous loop with signed review verdicts and native merging ([75df335](https://github.com/voidcorp-core/void-machine/commit/75df335453876b07e7ea0f2999d48280b6106087))
* **autopilot:** decide the continuous loop from Linear and GitHub state ([0c17c60](https://github.com/voidcorp-core/void-machine/commit/0c17c60ac5845671fe802c6c501c31b86edc2350))
* **autopilot:** disarm an auto-merge the loop can no longer vouch for ([3b5ba24](https://github.com/voidcorp-core/void-machine/commit/3b5ba24fa12a90b653fff30885819479203edd63))
* **autopilot:** fingerprint shared repository state around each unit ([65a0f71](https://github.com/voidcorp-core/void-machine/commit/65a0f71f5cf8230d3f1c9136d2d1951adda14c59))
* **autopilot:** name every cause that sends a ticket to a human ([bbb0bc2](https://github.com/voidcorp-core/void-machine/commit/bbb0bc2da5eea77eaae2667dd6c0771c97831b98))
* **autopilot:** name the one label that marks a ticket for a human ([fb067f9](https://github.com/voidcorp-core/void-machine/commit/fb067f9f6eb4137fb232b93c7b4268e80cccfb29))
* **autopilot:** never merge a change to the machinery that judges merges ([9679c6d](https://github.com/voidcorp-core/void-machine/commit/9679c6dccf8b05dc6769ebe0f73d05fb0f5ebc47))
* **autopilot:** prove a review verdict with a seal only the reviewer holds ([caff9ba](https://github.com/voidcorp-core/void-machine/commit/caff9ba8057ebb94a11c196d4306a7cd8e9e33b5))
* **autopilot:** read verdicts and conflict classes from the pull request ([d8eef19](https://github.com/voidcorp-core/void-machine/commit/d8eef1990d2e4fb587e97b6d9f1d3d8870383365))
* **autopilot:** run a continuous loop with a dedicated curator ([3125ef4](https://github.com/voidcorp-core/void-machine/commit/3125ef48d5bb4a10407de796bae336f1a3e3c959))
* **autopilot:** sign review verdicts so the required check refuses a forged one ([5d649db](https://github.com/voidcorp-core/void-machine/commit/5d649db3df920de9fbd8fdcc3c5ed0108fc1ce3d))
* **autopilot:** validate every agent judgment before acting ([0010cfa](https://github.com/voidcorp-core/void-machine/commit/0010cfa1250e62eda454f9c9d115fd61ccb8474f))
* **autopilot:** write a review verdict through one command only ([9393d41](https://github.com/voidcorp-core/void-machine/commit/9393d41e7faa99b73fe080c61782492f50b75b5a))
* **brand:** name the product Void Machine in every message and live doc ([35e2406](https://github.com/voidcorp-core/void-machine/commit/35e24062672a963fe4ac29bc7e858c5baa1cfdf0))
* **brand:** name the product Void Machine, and migrate what 3.x wrote ([149162f](https://github.com/voidcorp-core/void-machine/commit/149162ff856b47a9515e12deb9142121bd9e02fc))
* **ci:** accept an automatic merge into develop that carries its verdict ([5cbc4eb](https://github.com/voidcorp-core/void-machine/commit/5cbc4ebb129bf3b46889b9c5f86ee8ed8961bf76))
* **ci:** exempt the release back-merge from the review verdict ([b3afd37](https://github.com/voidcorp-core/void-machine/commit/b3afd37143d399a1f42b2994dffb7feff40bdc2e))
* **ci:** isolate consumer dependency audits from quality ([842b2a7](https://github.com/voidcorp-core/void-machine/commit/842b2a79cf4b2328ef3e4d52fda2374a3e013457))
* **ci:** isolate consumer dependency audits from quality ([29cade1](https://github.com/voidcorp-core/void-machine/commit/29cade1f0fec4ad2ef33c7275ab154a359f4131b))
* **ci:** make auto-merge the default way into develop, never into main ([deaa5b2](https://github.com/voidcorp-core/void-machine/commit/deaa5b2049e37e937662221415eeb9cfd7c2afe7))
* **ci:** publish the public key that proves a review verdict ([f85d86c](https://github.com/voidcorp-core/void-machine/commit/f85d86ca9478a8dec819172512633a035b2530c8))
* **ci:** publish the public key that proves a review verdict ([f204352](https://github.com/voidcorp-core/void-machine/commit/f204352e6815873bcdcd3c7cdcf3a20813c04d04))
* **cli:** expose the continuous loop decisions ([682e790](https://github.com/voidcorp-core/void-machine/commit/682e790506e75ccc098d1ebb5aeb3b8ff9727430))
* **cli:** stop publishing the void-machine launcher ([762435a](https://github.com/voidcorp-core/void-machine/commit/762435aac6a057dcd761f1f85dc252d4beac67b2))
* **graph:** analyse projects that expose the TypeScript 6 compiler API ([83b8d66](https://github.com/voidcorp-core/void-machine/commit/83b8d66f478f815e34755f2f387ea27912f4d03f))
* **graph:** explain declared decisions and clarify failed installs ([07ce0c1](https://github.com/voidcorp-core/void-machine/commit/07ce0c12714f58b1d1fd4da1e267e5f3ca44fbef))
* **graph:** explain declared decisions and invariants with why ([2d2926a](https://github.com/voidcorp-core/void-machine/commit/2d2926a500bbc5e1673be344afeef79476276bd7))
* **hooks:** offer session updates with explicit consent ([ecb7b1c](https://github.com/voidcorp-core/void-machine/commit/ecb7b1c537a5d12e9261c75b93619a20884093ee))
* **hooks:** refuse a review verdict written by hand ([854447f](https://github.com/voidcorp-core/void-machine/commit/854447f7a34e2efb9e4465635269561d0d19dd87))
* **identity:** read managed blocks and settings under every former brand ([4ab3963](https://github.com/voidcorp-core/void-machine/commit/4ab3963e73d6c2ad7c04d4ad39a19403cb19999e))
* **machine:** admit step values with a parser instead of a predicate ([150db10](https://github.com/voidcorp-core/void-machine/commit/150db10ee57035f9b339c8ee8d30e3e2a4f9db35))
* **machine:** generalize durable mission lifecycle ([764d361](https://github.com/voidcorp-core/void-machine/commit/764d36156a0915cd8c33b26927edcf984ff872f0))
* **machine:** implement bounded sourced-note relay ([edeb6d1](https://github.com/voidcorp-core/void-machine/commit/edeb6d12388fcbd1a788fec071f0f3d3c799711d))
* **machine:** implement read-only TypeScript doctor ([7d8ac31](https://github.com/voidcorp-core/void-machine/commit/7d8ac314a4cbdec35f8d4cca2c84128fa164c323))
* **machine:** keep the observed cost of a result that returns after cancellation ([af8fba6](https://github.com/voidcorp-core/void-machine/commit/af8fba6fb72d13af70058d653b0685a627bd8f0a))
* **machine:** record a refused live result as a terminal rejection ([be14ecf](https://github.com/voidcorp-core/void-machine/commit/be14ecf8f72393e6c48da8d673aebf9a1c1c8fa5))
* **mission:** migrate declared specialist contracts without resets ([c9bc337](https://github.com/voidcorp-core/void-machine/commit/c9bc337d3599cc065639c952fc845833501c7db0))
* rename to void-machine from a single product identity ([e79d26c](https://github.com/voidcorp-core/void-machine/commit/e79d26cfa2c0af4a5289847da76d74ac5cbd9e14))
* **review:** post the independent-review check as a GitHub App of its own ([634e2aa](https://github.com/voidcorp-core/void-machine/commit/634e2aad059858c3e2f16466531d5178c00733fd))
* **review:** run the independent review as a GitHub Actions job ([3c24b5f](https://github.com/voidcorp-core/void-machine/commit/3c24b5f51f8bd28b0d4f71e0523e94e32bdf7a63))
* **void-machine:** add bounded Claude runtime adapter ([e2c1268](https://github.com/voidcorp-core/void-machine/commit/e2c126811fcaf58c575c94af1e8010b9817d038c))
* **void-machine:** add TypeScript foundation, durable resume and cancellation ([e0e8afa](https://github.com/voidcorp-core/void-machine/commit/e0e8afa2a05efcc53d3d7f038e3c9717a69b8db1))
* **void-machine:** cancel and abandon note missions from the journal ([34aaabb](https://github.com/voidcorp-core/void-machine/commit/34aaabbe6e63393c54377c153fb30d15f599028d))
* **void-machine:** connect TypeScript relay to Claude runtime ([44723ad](https://github.com/voidcorp-core/void-machine/commit/44723ad08efdf3052e8210f05f25f715374a8bdb))
* **void-machine:** resume note missions from a durable journal ([04d66b0](https://github.com/voidcorp-core/void-machine/commit/04d66b09cf9c503027caec900665698a6322476e))
* **worktrees:** preserve ticket checkouts through observed merge ([7cd7e6d](https://github.com/voidcorp-core/void-machine/commit/7cd7e6d6252c995392303dc473354f03a0aa3a39))


### Bug Fixes

* **autopilot:** arm a merge only on a clean verdict bound to the head ([b579035](https://github.com/voidcorp-core/void-machine/commit/b579035b7323c531bf51e508f234c5be13ce2980))
* **autopilot:** believe a verdict comment only when its status agrees ([19f53d5](https://github.com/voidcorp-core/void-machine/commit/19f53d5ad70e21684f8bbf282ff3f6592f37d42c))
* **autopilot:** count a merge queue entry as armed, and dequeue to disarm ([b170ccb](https://github.com/voidcorp-core/void-machine/commit/b170ccbf8ed2d28b2840ceca2f5ce79571180704))
* **autopilot:** count a merge queue entry as armed, and dequeue to disarm ([b03d17f](https://github.com/voidcorp-core/void-machine/commit/b03d17fa8f057626e99380ff0f46ce12cc0b4041))
* **autopilot:** count review rounds on GitHub, not in the verdict ([95d0ebc](https://github.com/voidcorp-core/void-machine/commit/95d0ebcc779ce1c75f95c5c96ba38a1ed38d2e28))
* **autopilot:** disarm before any outcome that stops watching an armed head ([f9c4f62](https://github.com/voidcorp-core/void-machine/commit/f9c4f6253896c8e95c44581f4f9d5f1956242ad8))
* **autopilot:** fingerprint every part of Git the worktrees share ([c2ffbfa](https://github.com/voidcorp-core/void-machine/commit/c2ffbfad2c11ccc2bbaf646a5cf6ee707843bcb5))
* **autopilot:** keep the ground of a pull request waiting for a human ([d962d72](https://github.com/voidcorp-core/void-machine/commit/d962d72413522acaa9333837f503351707bf7bf1))
* **autopilot:** leave human merge gates out of the human-wait streak ([fa2b9c1](https://github.com/voidcorp-core/void-machine/commit/fa2b9c105359a2de1f0e94795e57706ff062e580))
* **autopilot:** let parallel units set and drop their own upstreams ([4d33fa4](https://github.com/voidcorp-core/void-machine/commit/4d33fa48f9c7ecf4918e6ae1fadc1ee1e34ff5de))
* **autopilot:** never arm a merge into the branch that deploys ([9f99ae2](https://github.com/voidcorp-core/void-machine/commit/9f99ae2f4dd2c8cdb4906a63ab257715110e765e))
* **autopilot:** protect the scripts that judge a publication ([1f558fa](https://github.com/voidcorp-core/void-machine/commit/1f558fa4070fa016a07200074b183369fdef83d0))
* **autopilot:** protect what a judging workflow runs outside .github ([571ac49](https://github.com/voidcorp-core/void-machine/commit/571ac498641d654f8737dbedb75179e9e288b4ea))
* **autopilot:** re-queue an ejected head that still passes, twice at most ([265b268](https://github.com/voidcorp-core/void-machine/commit/265b26817dcc5d645337b0db360b808a2bcff2fb))
* **autopilot:** re-run the review job left red under an approved head ([9d1ba64](https://github.com/voidcorp-core/void-machine/commit/9d1ba64c3a3e88a25c2281d3da3697531d0d3b7f))
* **autopilot:** re-run the review job twice at most per run ([9d3469f](https://github.com/voidcorp-core/void-machine/commit/9d3469f935b02ec178dd5584d083efb0c1ae1f5c))
* **autopilot:** record a unit's shared state baseline only once ([74ab287](https://github.com/voidcorp-core/void-machine/commit/74ab2876925d723a64af46767c291c90a393ad4c))
* **autopilot:** refuse serial merges on a base that allows stale branches ([1fbe94c](https://github.com/voidcorp-core/void-machine/commit/1fbe94cc04f1c106fd7bd29efe5f4c8d478bf21a))
* **autopilot:** refuse to handle a review secret outside the orchestration checkout ([72c8e35](https://github.com/voidcorp-core/void-machine/commit/72c8e3506a8a53acc1eed77d53c084e56f6156fe))
* **autopilot:** resume a ready ticket that already has a branch ([96914f6](https://github.com/voidcorp-core/void-machine/commit/96914f6bc9ed2f8dcf542adae8233a1b3e98ccf2))
* **autopilot:** see a protected file moved away, and the hooks that run here ([f3f2903](https://github.com/voidcorp-core/void-machine/commit/f3f29034cfb9dbfa70284f960e8037ea73ab6750))
* **ci:** accept a promoted merge by the verdict on its head, whatever its timeline ([5912aeb](https://github.com/voidcorp-core/void-machine/commit/5912aebb6c0474e5f90b84f96b89bbc62daffa9b))
* **ci:** fail a merge group walk that does not reach the base head ([e1c9f0a](https://github.com/voidcorp-core/void-machine/commit/e1c9f0a1727d729c0bf3b91d7d0c335439341d81))
* **ci:** let the promotion audit judge merge authority through the module ([2da6b77](https://github.com/voidcorp-core/void-machine/commit/2da6b77f4e703c1357cf2c57397b232fcf3763d8))
* **ci:** prove the back-merge's commits before exempting it ([fd3ec76](https://github.com/voidcorp-core/void-machine/commit/fd3ec7657e4d37ed9793415cee84018011e57e4d))
* **cli:** let npx run voidmachine by its package name ([aae9ea7](https://github.com/voidcorp-core/void-machine/commit/aae9ea73a13bbc240ffef25a2b6142789a6ab567))
* **deps:** give the repository root the TypeScript 7 tsc it tests with ([4d6b966](https://github.com/voidcorp-core/void-machine/commit/4d6b966332f36293ad3678aeb5e7b8cabfb24681))
* **docs:** include local sync in authorized merge consent ([1efeedf](https://github.com/voidcorp-core/void-machine/commit/1efeedf1f018de907fa008b18c96fd0727d2ebfc))
* **docs:** include local sync in authorized merge consent ([cac4151](https://github.com/voidcorp-core/void-machine/commit/cac41512f8900344d09f7d8e69526f273d72cd04))
* **graph:** name the alias when a project resolves TypeScript 7 ([6f46511](https://github.com/voidcorp-core/void-machine/commit/6f46511f4fc5e50d687a41ae0e1f5b46e1146ea4))
* **harness:** refresh published floor and separate process proofs ([da9a6af](https://github.com/voidcorp-core/void-machine/commit/da9a6af71fd75d96e1696198759130d0c272c299))
* **hooks:** offer harness updates once with explicit consent ([5eb8159](https://github.com/voidcorp-core/void-machine/commit/5eb8159d3460ad07feb3837e7911b930ae7b0268))
* **hooks:** own the isolated syntax parser ([77651b3](https://github.com/voidcorp-core/void-machine/commit/77651b31fe715c9cd6a8bfc4424e43b8754a36cb))
* **hooks:** own the official typescript syntax worker ([44c1512](https://github.com/voidcorp-core/void-machine/commit/44c151218b1fb28124b4411cd69ba7af635518c9))
* **hooks:** own the official TypeScript syntax worker ([7ce5a87](https://github.com/voidcorp-core/void-machine/commit/7ce5a87db8b5d15c239dcfdb3971e24f195a9cfd))
* **hooks:** read the words a verdict write passes, and refuse what it hides ([dff2b88](https://github.com/voidcorp-core/void-machine/commit/dff2b88183f41f3a7b673271d2681454ced10929))
* **hooks:** read what a line runs before letting it write a verdict ([a6cf7dd](https://github.com/voidcorp-core/void-machine/commit/a6cf7dd7901de9cc4a29cd294cf12417a0c918c1))
* **hooks:** separate CI artifact and runtime input bounds ([f34118d](https://github.com/voidcorp-core/void-machine/commit/f34118dbcd85cbc6cb443c5cba3379dcc27a5c83))
* **hooks:** separate syntax semantics from process deadline proofs ([004a8aa](https://github.com/voidcorp-core/void-machine/commit/004a8aa67b542d01d84d7edbc2cf208d186e1f7b))
* **identity:** drop every block nested in a kept managed block ([e18e48c](https://github.com/voidcorp-core/void-machine/commit/e18e48c57ebae38d98fc66323744e0c2a3216db7))
* **init:** describe layout repairs that survive install failure ([c6ba913](https://github.com/voidcorp-core/void-machine/commit/c6ba913f732700498ec62475be97abb57bf08709))
* **install:** distinguish template provenance from observed doctrine ([98d108e](https://github.com/voidcorp-core/void-machine/commit/98d108e337ab5a26a6f5e130d0e0373ef49f2274))
* **machine:** anchor doctor contracts to current sources ([c490e66](https://github.com/voidcorp-core/void-machine/commit/c490e667286681e7ad76a173d3adb120111bcfaa))
* **machine:** announce test barriers on a loopback port, not a named socket ([89dae6f](https://github.com/voidcorp-core/void-machine/commit/89dae6f647dfe3071d44213c6206779a3e970448))
* **machine:** keep the cost of a result that returns after an abandonment ([60c010f](https://github.com/voidcorp-core/void-machine/commit/60c010fcd47de308c3a934ca75876aa8302d6da1))
* **machine:** refuse a second discarded result in the mission reducer ([f065006](https://github.com/voidcorp-core/void-machine/commit/f0650062ea386313b957971dbdb0ece9a0b3e138))
* **machine:** report a discarded late result as a known stop ([22de421](https://github.com/voidcorp-core/void-machine/commit/22de421546555fc8e9dc8a9bf56885be8c4b8f2d))
* **machine:** report a failed late-cost write as storage, not as the stop ([a459ef2](https://github.com/voidcorp-core/void-machine/commit/a459ef25f83402a2f7b4714224f6670a8868e9f8))
* **mission:** admit bounded recovery corrections and fresh reviews ([9a106f7](https://github.com/voidcorp-core/void-machine/commit/9a106f7e9075189f7b0993c099b6418dc3e2e207))
* **mission:** bound independent review correction batches ([6d645a7](https://github.com/voidcorp-core/void-machine/commit/6d645a716c06cc69aaf2aaf9a608e4c13ad97a18))
* **mission:** call a broken specialist invalid, even on another version ([f939dc5](https://github.com/voidcorp-core/void-machine/commit/f939dc5f4f573816a737a572c50ce544d79dc0df))
* **mission:** name the drifted specialist, both versions, and the repair ([e0babdf](https://github.com/voidcorp-core/void-machine/commit/e0babdf2565b1bc650a5e1c26c45817989d01f83))
* **mission:** name the drifted specialist, both versions, and the repair ([e80551b](https://github.com/voidcorp-core/void-machine/commit/e80551b7878fb15a8389a246b429668b4efcd00f))
* **mission:** preserve recovery across specialist migration ([0d883e6](https://github.com/voidcorp-core/void-machine/commit/0d883e6315ce99e9c628e337984fd231b676b584))
* **mission:** preserve recovery and bound independent reviews ([0924cde](https://github.com/voidcorp-core/void-machine/commit/0924cded8a502f24fd4f16f968f1e36b8267aea9))
* **mission:** preserve review continuity and audited recovery ([37c2068](https://github.com/voidcorp-core/void-machine/commit/37c20683fbacc3225623b47c3d3a03136b1df604))
* **mission:** recover preparation obligations when due ([13dfac9](https://github.com/voidcorp-core/void-machine/commit/13dfac9ac0ba2ddf179c1b2c52a0d4ca96f79850))
* **mission:** recover stopped episodes through declared migration ([b51d813](https://github.com/voidcorp-core/void-machine/commit/b51d813e9ddaed55ffd894224338e8699e010e65))
* **mission:** respect latest review dispositions and inspectable inputs ([b0d49be](https://github.com/voidcorp-core/void-machine/commit/b0d49bede866e46397334fb50be3f0885fe16629))
* **mission:** retain evidenced resolutions across correction batches ([1afc97e](https://github.com/voidcorp-core/void-machine/commit/1afc97ef1380d1ec0fb2f93bb1d9e221714e18e3))
* **pack-monorepo:** document a tsconfig that compiles under TypeScript 6 and 7 ([6b2c95a](https://github.com/voidcorp-core/void-machine/commit/6b2c95a53ff02b2c7abd0752712fc3ed9a1a03e1))
* **promotion:** keep the audit query under the GraphQL node limit ([76a6d61](https://github.com/voidcorp-core/void-machine/commit/76a6d61889d138a4c8b42be6ffbbafc15f234c53))
* **release:** back-merge on ancestry, not on equal trees ([a7cdabf](https://github.com/voidcorp-core/void-machine/commit/a7cdabf5c360008d9a36b554a2b109fd94beafbd))
* **release:** back-merge on ancestry, not on equal trees ([48ff751](https://github.com/voidcorp-core/void-machine/commit/48ff75164da6015139f4fecbde65e3cb89d16250))
* **review:** anchor the review to the default branch it runs from ([8f186c5](https://github.com/voidcorp-core/void-machine/commit/8f186c5c4b72f4c7992a23577db7fb2e3c30ac44))
* **review:** believe a run of the review workflow in the queue, not the check ([1df6c00](https://github.com/voidcorp-core/void-machine/commit/1df6c001a86c3b07332a8ea3eca6db1366b5ad32))
* **review:** give the review enough turns to conclude on a large diff ([0cfdf19](https://github.com/voidcorp-core/void-machine/commit/0cfdf19edc242b756f629d1bd486c757fc7a994c))
* **review:** give the review enough turns to conclude on a large diff ([98742e6](https://github.com/voidcorp-core/void-machine/commit/98742e6f63670b4c6ae8f07751b259465d5b1130))
* **review:** keep the App token dead while the model reads the head ([912945f](https://github.com/voidcorp-core/void-machine/commit/912945ff212b1a84c28e1133fb814b322b1f3a7f))
* **review:** promotion audit query budget, and anchor the review to the default branch ([692cb99](https://github.com/voidcorp-core/void-machine/commit/692cb99d3c5c08d4ca3832d8c66c7be99c00872a))
* **review:** title a draft's run apart from a review of its head ([631c964](https://github.com/voidcorp-core/void-machine/commit/631c9642721180041b291d21883534da40f3161e))
* **telemetry:** separate topology evidence from deadline policy ([64d9622](https://github.com/voidcorp-core/void-machine/commit/64d9622cac5704c75debcf97503c57a8b2bdf9a7))
* **visual:** assess rendered scope before requiring captures ([#384](https://github.com/voidcorp-core/void-machine/issues/384)) ([b90cbde](https://github.com/voidcorp-core/void-machine/commit/b90cbdef1cac763f80042a4664121daa8310b44c))


### Code Refactoring

* **autopilot:** read the review from its check, drop the signing key ([66d63ca](https://github.com/voidcorp-core/void-machine/commit/66d63caec71cdaa14f384cda4150507dbf8f1e97))
* **autopilot:** remove the cluster reconciliation engine ([8ceab79](https://github.com/voidcorp-core/void-machine/commit/8ceab793ab6e97503272aeee90bd1b0aec746492))
* **hooks:** remove the review-verdict-write rule and its shell parser ([fbc6fd9](https://github.com/voidcorp-core/void-machine/commit/fbc6fd969d11b709313c71a4eea831357663e7cb))


### Build System

* **engines:** require Node 24.15 in every package ([91b5134](https://github.com/voidcorp-core/void-machine/commit/91b51344dfb18cda1486e9e8a1b20997330dca7a))

## [3.8.0](https://github.com/voidcorp-core/void-harness/compare/v3.7.1...v3.8.0) (2026-09-15)


### Features

* **agents:** enforce specialist tool allowlists ([3e51f2f](https://github.com/voidcorp-core/void-harness/commit/3e51f2f275feefe4253d9bea39f0b7eee5eb50a6))
* **autopilot:** bound unanswered human recovery ([#362](https://github.com/voidcorp-core/void-harness/issues/362)) ([88f2533](https://github.com/voidcorp-core/void-harness/commit/88f2533e09fd9d84f7028c92add2f8077bbe29d2))
* **autopilot:** move specialist panels to orchestrator ([#363](https://github.com/voidcorp-core/void-harness/issues/363)) ([457d1f6](https://github.com/voidcorp-core/void-harness/commit/457d1f6a6ed248056612b5e999ac3c47b4eab660))
* **autopilot:** persist durable no-effect run state ([4beef2a](https://github.com/voidcorp-core/void-harness/commit/4beef2aa5e9a013e6b8ae7bc984a4a0897c13184))
* **autopilot:** reconcile progress and CI effects ([#361](https://github.com/voidcorp-core/void-harness/issues/361)) ([2870108](https://github.com/voidcorp-core/void-harness/commit/287010857ae33260afd89d06a1294bc55f05ba42))
* **autopilot:** seal observed run evidence ([20d3c3c](https://github.com/voidcorp-core/void-harness/commit/20d3c3cd440399d5e447e656472e34c9714c3bda))
* **autopilot:** start runs through durable state ([8963ae4](https://github.com/voidcorp-core/void-harness/commit/8963ae42aeea44c3a2bf9b3cad1b5a899af2a856))
* **cheatsheet:** export installed discovery documents ([8e5476c](https://github.com/voidcorp-core/void-harness/commit/8e5476c5d1143cdec5672a88b9f805aa8d8aa349))
* **cheatsheet:** integrate installed capability discovery ([#375](https://github.com/voidcorp-core/void-harness/issues/375)) ([f8269ea](https://github.com/voidcorp-core/void-harness/commit/f8269eae571fa8cf321fd0ee81357d42a1d55442))
* **eval:** add deterministic consumer preflight ([23a2758](https://github.com/voidcorp-core/void-harness/commit/23a275807a06547f7ef6e026fe408144ddec39ed))
* **graph:** materialize project knowledge artifact ([bbf86cb](https://github.com/voidcorp-core/void-harness/commit/bbf86cb86fca156fbc70a302ae151a6776c76a19))
* **graph:** materialize project knowledge artifact ([9ddf21d](https://github.com/voidcorp-core/void-harness/commit/9ddf21db41c0f309ccbf6287fb1988672bf27c33))
* harden specialist and promotion gates ([a83cdc7](https://github.com/voidcorp-core/void-harness/commit/a83cdc7a15786e48d725986a017fcf30204c362b))
* **hooks:** protect delivered harness assets ([2469a81](https://github.com/voidcorp-core/void-harness/commit/2469a8118ae2e7e79974a5049d5b2c55e6305771))
* **machine:** add portable legacy consumer oracle ([3036743](https://github.com/voidcorp-core/void-harness/commit/30367439c551027ca909686ce11bda87152ee243))
* **machine:** apply one Git effect effectively once ([#359](https://github.com/voidcorp-core/void-harness/issues/359)) ([a1f2369](https://github.com/voidcorp-core/void-harness/commit/a1f236962dd12dd058d5267200a9275f9e67eab1))
* **machine:** fail fast on legacy oracle drift ([5e856b5](https://github.com/voidcorp-core/void-harness/commit/5e856b5f8325849910ef7ad84720199c69fc46ac))
* **machine:** freeze native VM-01 consumer contract ([e054e51](https://github.com/voidcorp-core/void-harness/commit/e054e5185e38bd0afcae1a441ac26db646ce146f))
* **machine:** guard autonomous develop merges ([0aca40f](https://github.com/voidcorp-core/void-harness/commit/0aca40f5bf30632797a0015ab877d77302ac2f29))
* **machine:** guard autonomous develop merges ([35931a5](https://github.com/voidcorp-core/void-harness/commit/35931a5ecaea1cd9db61a67da138c1c4662ff0b1))
* **machine:** persist no-effect run proofs ([4a32b85](https://github.com/voidcorp-core/void-harness/commit/4a32b85c4dce92d6230f82e7de581009469a0126))
* **machine:** reconcile bounded autopilot clusters ([e01d4c0](https://github.com/voidcorp-core/void-harness/commit/e01d4c0e3bc0f017c2d6a4cfffad77fc6c3d0155))
* **machine:** reconcile bounded clusters in native core ([0a0e499](https://github.com/voidcorp-core/void-harness/commit/0a0e4998a6bea276ba1e223f4094a0533d03238b))
* **machine:** ship read-only native doctor ([7eafd0d](https://github.com/voidcorp-core/void-harness/commit/7eafd0d20ba3a0e55c971f0d5654e3b4596d9fec))
* **machine:** validate durable run contracts ([0e898ca](https://github.com/voidcorp-core/void-harness/commit/0e898caddb55719aacf8eaee60ccce8a13b9206d))
* **machine:** validate executable skill packages ([5f42d90](https://github.com/voidcorp-core/void-harness/commit/5f42d90ea27a9fa60bc54767a1f0c7637339b6f1))
* **machine:** validate executable skill packages ([021d96d](https://github.com/voidcorp-core/void-harness/commit/021d96db734435f4b56a6cc25a9308ffebcc3c5e))
* **managed:** cut over single-ticket implementation to native machine ([#364](https://github.com/voidcorp-core/void-harness/issues/364)) ([b774cd5](https://github.com/voidcorp-core/void-harness/commit/b774cd59ba08057fbf582b40e7624e027d3b0c4f))
* protect delivered harness assets ([bee1171](https://github.com/voidcorp-core/void-harness/commit/bee11711dc3562a63510e89cb98d7871592f065e))
* **routing:** rank only eligible routes ([e72029a](https://github.com/voidcorp-core/void-harness/commit/e72029af536717cb87f0895df0560e02b2967932))
* **routing:** rank only eligible routes ([bc7eb22](https://github.com/voidcorp-core/void-harness/commit/bc7eb222a7b75b5dd371d45ee5627d00e22ed2e3))
* **runtime:** certify Claude subscription execution ([8c91701](https://github.com/voidcorp-core/void-harness/commit/8c917010d8b091f7812cd91d608c2f1eadff9b9f))
* **runtime:** certify Claude subscription execution ([0371a83](https://github.com/voidcorp-core/void-harness/commit/0371a831f353cf9d9c644d5ac45ffe6ee0f1fbae))
* **runtime:** certify Codex subscription execution ([5a389f0](https://github.com/voidcorp-core/void-harness/commit/5a389f03d81f3239acac5b94a59e87390aecf0ed))
* **runtime:** certify Codex subscription execution ([c9fef7a](https://github.com/voidcorp-core/void-harness/commit/c9fef7a87d1eda4fcfef46c8c29cb12021f71050))


### Bug Fixes

* **autopilot:** preserve sqlite builtin in bundled cli ([0f797bd](https://github.com/voidcorp-core/void-harness/commit/0f797bd00fed38ba8f1d0e697d1a23fc9022b13a))
* **cheatsheet:** bring mobile results into the initial viewport ([e507b35](https://github.com/voidcorp-core/void-harness/commit/e507b353a8f4980026053ef109628623adbc14d1))
* **cheatsheet:** let enlarged controls reflow into one column ([8658117](https://github.com/voidcorp-core/void-harness/commit/865811715dd888415cb0ccea8f95326f326730b5))
* **cheatsheet:** refresh results after native form reset ([20e2e0d](https://github.com/voidcorp-core/void-harness/commit/20e2e0d7dcb34022a1b29cf7ebe081c202af9f21))
* **cheatsheet:** strengthen form control contrast ([b10e3b5](https://github.com/voidcorp-core/void-harness/commit/b10e3b534ea65ca19b4f3f04349af76b2ecb2e2d))
* **cli:** restore and report previously claimed managed assets ([9cf8a9e](https://github.com/voidcorp-core/void-harness/commit/9cf8a9ef6d60b34f2c3d884fca0498cda8ad1abf))
* **cli:** restore and report previously claimed managed assets ([7c3d669](https://github.com/voidcorp-core/void-harness/commit/7c3d669de350e33375ff007725ca3260f3acf918))
* **conformance:** expose active steps and stop after failed proofs ([ebd7921](https://github.com/voidcorp-core/void-harness/commit/ebd792177a9ed397d3079123fac4a2cb38ed4d51))
* **conformance:** share package installation across runtime proofs ([58f702a](https://github.com/voidcorp-core/void-harness/commit/58f702a321ac5e839a2957277ac0264744a9b060))
* **enforce:** allow generated knowledge artifact ([a7e0c9b](https://github.com/voidcorp-core/void-harness/commit/a7e0c9b22d2c9186185160fa58d3f544705f699f))
* **enforce:** repair committed promotion checks ([#377](https://github.com/voidcorp-core/void-harness/issues/377)) ([aac55c8](https://github.com/voidcorp-core/void-harness/commit/aac55c8d580901addfa36620244fe321d3a80b44))
* **enforce:** separate committed evidence from tool-write ownership ([c2cd75d](https://github.com/voidcorp-core/void-harness/commit/c2cd75d949d92914861bde0474aa477687bc4a7b))
* **eval:** make value fixtures deliverable ([e043c48](https://github.com/voidcorp-core/void-harness/commit/e043c4819dd2638db506375e6b2f91fecc347f61))
* **eval:** reject empty delivery evidence ([0b44161](https://github.com/voidcorp-core/void-harness/commit/0b44161ce199019a5a9dcfac3259d1af977c1b56))
* **graph:** align packed conformance contract ([94ae926](https://github.com/voidcorp-core/void-harness/commit/94ae9261a9648a2d6c82bb3e14d8f90141b954e8))
* **graph:** exclude diagnostic counts from content identity ([b509b35](https://github.com/voidcorp-core/void-harness/commit/b509b35f4e87994fd5621c2e3e5be73f2e385b24))
* **graph:** keep knowledge hash semantic ([1d82cde](https://github.com/voidcorp-core/void-harness/commit/1d82cde067ec56627014a38bdefaab066018e5fd))
* **graph:** preserve exact native file identities ([791376c](https://github.com/voidcorp-core/void-harness/commit/791376c7e2825effdd7327fcbd0b6a38ca80ebf0))
* **hooks:** inspect complete test and E2E evidence (DEV-520) ([#374](https://github.com/voidcorp-core/void-harness/issues/374)) ([4ab3d56](https://github.com/voidcorp-core/void-harness/commit/4ab3d56b889f19fc1bf7bfceb7be91fd3df2d197))
* **hooks:** resolve durable telemetry roots without spawn overrides ([3e0cd81](https://github.com/voidcorp-core/void-harness/commit/3e0cd8133162840072a864fac619915bdcbe3432))
* **hooks:** retain legacy journal exclusions on managed refresh ([8dcea9c](https://github.com/voidcorp-core/void-harness/commit/8dcea9c3e658743b701b737f7cf56728822514ec))
* **hooks:** separate repository identity from policy scope ([a5ae59e](https://github.com/voidcorp-core/void-harness/commit/a5ae59ecac6a793113cea03d80a4f807fa18580c))
* **hooks:** verify linked identity without process contention ([30c5eee](https://github.com/voidcorp-core/void-harness/commit/30c5eee5611f40abde01f42d6b7eb3eeea56525a))
* **machine:** keep programme frontmatter canonical ([06697ef](https://github.com/voidcorp-core/void-harness/commit/06697efebcf9ee0a45995b0ac0e8206c6ac6726c))
* **machine:** satisfy native merge lint ([cf298fd](https://github.com/voidcorp-core/void-harness/commit/cf298fd3d89488af1dcf503a9275742e44b8f79b))
* **release:** batch promotion GraphQL audit requests ([5658d14](https://github.com/voidcorp-core/void-harness/commit/5658d142f3828369f9aeed171d108da02f7a8295))
* **routing:** freeze semantic ranking context ([fe458e1](https://github.com/voidcorp-core/void-harness/commit/fe458e1207e8c1d64b2366006f3fd825468f0289))
* **skills:** validate live plugin description references ([44d83c4](https://github.com/voidcorp-core/void-harness/commit/44d83c454ab978f450cf25908cbfca80b6d7de87))

## [3.7.1](https://github.com/voidcorp-core/void-harness/compare/v3.7.0...v3.7.1) (2026-09-10)


### Bug Fixes

* **enforcement:** allow generated dependency lockfile updates ([53d644f](https://github.com/voidcorp-core/void-harness/commit/53d644ffc33ea29484ccebc8463c9adc1ce8f706))
* **enforcement:** allow generated dependency lockfile updates ([c07e2cd](https://github.com/voidcorp-core/void-harness/commit/c07e2cde5bbefeedcdc7867bdb20093f633ed8e4))
* **profiles:** separate consumer versions from general guidance ([2c1e63b](https://github.com/voidcorp-core/void-harness/commit/2c1e63b9245962b998a501ed611a2a3f62872566))
* **profiles:** separate consumer versions from general guidance ([c667c3d](https://github.com/voidcorp-core/void-harness/commit/c667c3de40c9bd72f251e7327465af86e74e7701))

## [3.7.0](https://github.com/voidcorp-core/void-harness/compare/v3.6.0...v3.7.0) (2026-09-09)


### Features

* **autopilot:** a worker states what reviewed it, and the gate reads it ([9af5e8b](https://github.com/voidcorp-core/void-harness/commit/9af5e8bdb8d8e6d5eb8af96f64f8dd44ab8ef896))
* **cli:** resolve the work tree and the installation root as two values ([dff3784](https://github.com/voidcorp-core/void-harness/commit/dff3784270d72b7dab9cece9092e7320d766ab86))
* **eval:** bind durable reservations to approval authority ([fb8994f](https://github.com/voidcorp-core/void-harness/commit/fb8994fdcada9e80292f6fd0418ebdba39081ddf))
* **eval:** connect durable runtime execution behind explicit admission ([6d73a4e](https://github.com/voidcorp-core/void-harness/commit/6d73a4e59a533873c1d10200367173f5593986d6))
* **eval:** enforce budget authority at runtime admission ([008c96e](https://github.com/voidcorp-core/void-harness/commit/008c96e31a2053a2d1705ebfc4550a18afca8b0c))
* **eval:** enforce comparable campaign cells ([e8b7683](https://github.com/voidcorp-core/void-harness/commit/e8b7683b7b19828702d169489783a3349d0ea0a1))
* **eval:** enforce pilot approval contract ([aa3d9c2](https://github.com/voidcorp-core/void-harness/commit/aa3d9c2372107b34daa3561cb053575d43029084))
* **eval:** freeze autonomous campaign contract ([09fa1de](https://github.com/voidcorp-core/void-harness/commit/09fa1de42f0632177ec0382570300806be7721a4))
* **eval:** gate autonomous value reports ([8bf7d4e](https://github.com/voidcorp-core/void-harness/commit/8bf7d4e842ff1a9c49d5e5480193e85ccfeb05b0))
* **eval:** hydrate cells from approved tarball ([b3ed269](https://github.com/voidcorp-core/void-harness/commit/b3ed26924175b163f75c7c6e8fafe7070c3c6750))
* **eval:** isolate consumer cell workspaces ([46ba212](https://github.com/voidcorp-core/void-harness/commit/46ba212865901b65a50f32df1808ea29c316b57a))
* **eval:** orchestrate consumer pilot cells ([78d86f1](https://github.com/voidcorp-core/void-harness/commit/78d86f1cb38aae2855c685600ffb1d4123df5e28))
* **eval:** persist pilot admission before executing effects ([8bd04f0](https://github.com/voidcorp-core/void-harness/commit/8bd04f08c5e60faada50168ddba7917ec4c97121))
* **eval:** prepare reproducible pilot analysis ([012c52c](https://github.com/voidcorp-core/void-harness/commit/012c52ce53f688d7a239a352dd83c42c32c252d4))
* **eval:** seal isolated autonomous value cells ([8db4df8](https://github.com/voidcorp-core/void-harness/commit/8db4df8f288a00873d91cc5ebc6d1c21229146e3))
* **eval:** separate fast checks from agent campaigns ([db351a5](https://github.com/voidcorp-core/void-harness/commit/db351a55bb681cc058f203e14564b885a8b3a1fc))
* **supervision:** add optional native mission presentation ([9138364](https://github.com/voidcorp-core/void-harness/commit/91383645ad4db234ece96cd2a81a25872a39e2c1))
* **supervision:** add optional native mission presentation ([f28460d](https://github.com/voidcorp-core/void-harness/commit/f28460d24e6a6451fec4f9c16ca360b4a5ebecbe))
* **testing:** define reliable release E2E proof ([e3f16aa](https://github.com/voidcorp-core/void-harness/commit/e3f16aada33dd08f972bf461a3298b05113d1e5e))
* **testing:** prove release E2E on shipped artifacts ([1bc6368](https://github.com/voidcorp-core/void-harness/commit/1bc6368807184166ed6dda657adef60ed0184cbc))


### Bug Fixes

* **autopilot:** a merge is the commit GitHub reported, never the grant that permitted it ([5da4f63](https://github.com/voidcorp-core/void-harness/commit/5da4f63560f0a6f9cbeafd5ca3c9f0a8327024d1))
* **autopilot:** a unit handed back is taken, not remaining, and it still measures ([e948b0a](https://github.com/voidcorp-core/void-harness/commit/e948b0a8bfc6895423390cf32fbad0f8bae8d78f))
* **autopilot:** a unit the run could not finish is taken and written down, not silently dropped ([5a7e9f6](https://github.com/voidcorp-core/void-harness/commit/5a7e9f68a447cbd3555cc5ce08e3686791069670))
* **autopilot:** apply tracker actions through the connector and take the lease with start ([b83b9a7](https://github.com/voidcorp-core/void-harness/commit/b83b9a7454af2917cd3cb0272dd8fcde2c094afa))
* **autopilot:** apply tracker actions through the connector and take the lease with start ([dad1cc1](https://github.com/voidcorp-core/void-harness/commit/dad1cc1013e6ecbe198dbb2ef105932d0a60903e))
* **autopilot:** deny a worker the mission journals, which the repository owns ([44af265](https://github.com/voidcorp-core/void-harness/commit/44af265cf3996bf5984b29a64dff9b58f075d573))
* **autopilot:** keep the skill under the cap the size test actually measures ([385953f](https://github.com/voidcorp-core/void-harness/commit/385953f8ec6734e52197f3d57edf70862b6c220c))
* **autopilot:** measure the chain budget over finished units only, and drop the floor ([4be3a4e](https://github.com/voidcorp-core/void-harness/commit/4be3a4e3618fe4744461e1cecd5f8c7bb76b3338))
* **autopilot:** read the taken entries, not just the set of tickets they name ([3ef866f](https://github.com/voidcorp-core/void-harness/commit/3ef866f2b8f04a0d37a17b15d5f0655ea3c65d20))
* **autopilot:** reconcile reads a range as a set, so any commit order integrates ([d24c394](https://github.com/voidcorp-core/void-harness/commit/d24c394a34ee8f955433ee804de5a867247f6481))
* **autopilot:** reconcile the three contradictions the composed branch revealed ([4100c55](https://github.com/voidcorp-core/void-harness/commit/4100c553841d7d666f835d775580fd2585ed5c56))
* **autopilot:** stop presenting the lease-time cursor as the run position ([dfd7ec1](https://github.com/voidcorp-core/void-harness/commit/dfd7ec1b6c203f0f46fe2c1437f07092d1baeab4))
* **autopilot:** the Codex adapter exports the installation root, so a worker's hook telemetry outlives its worktree ([d8afd27](https://github.com/voidcorp-core/void-harness/commit/d8afd27a5a1f4dea12640895eac5af7a94008132))
* **build:** declare consumer scratch prefixes ([ab625bb](https://github.com/voidcorp-core/void-harness/commit/ab625bb07723963576b8cb856802734ecf96fc51))
* **build:** make hook bundle paths reproducible ([07e366a](https://github.com/voidcorp-core/void-harness/commit/07e366a78ab69e12c0fca1027cb927e6bc9b4be3))
* **build:** normalize generated hook paths ([8afbac6](https://github.com/voidcorp-core/void-harness/commit/8afbac6ba62081dbf2b238e4fe4e7706ce61ecad))
* **check:** name the installation directory in every remedy printed from a worktree ([f7a80ef](https://github.com/voidcorp-core/void-harness/commit/f7a80ef8421bdbac7614f4e6f5f041d2eb0a1de6))
* **ci:** build filtered workspace type dependencies ([2865a02](https://github.com/voidcorp-core/void-harness/commit/2865a027aa877fc796b695f0a58f08b8b3fc692b))
* **cli:** resolve the listed main path to a tree, and let the receipt pick the install ([473291b](https://github.com/voidcorp-core/void-harness/commit/473291baa1d212c44594544a825bb37aa9a081e2))
* complete DEV-395 GStack teardown ([322702d](https://github.com/voidcorp-core/void-harness/commit/322702d24ea00e0f8294759632818f426b8d06f6))
* **conformance:** distinguish examples from monorepo dependencies ([f1cf95d](https://github.com/voidcorp-core/void-harness/commit/f1cf95d7f795ff380567f1920837f9d34e0a6a19))
* **conformance:** keep private paths outside skill namespace ([284cae2](https://github.com/voidcorp-core/void-harness/commit/284cae2adb5bc90ff8e379da483da08e2137ecfb))
* **conformance:** reject untracked artifact inputs ([d458442](https://github.com/voidcorp-core/void-harness/commit/d45844207cbceb2259f1098c87b1b08fb118ef9d))
* **context:** recheck lock age after acquiring recovery ([c906c99](https://github.com/voidcorp-core/void-harness/commit/c906c996c054a3d8b344948a9adfd2ac3ede8221))
* **controller:** allow reviewed degraded runtimes to finish ([e2ba20a](https://github.com/voidcorp-core/void-harness/commit/e2ba20a36a9acf491878d040e3fe793d12e73e2e))
* **controller:** allow reviewed degraded runtimes to finish ([c8ca5a6](https://github.com/voidcorp-core/void-harness/commit/c8ca5a68b90f0da631c29d5d9d1be1700ec34227))
* **controller:** continue after preparation correction ([e96945a](https://github.com/voidcorp-core/void-harness/commit/e96945a18b9d7e2096a048c6a52374840d22afb6))
* **controller:** resume preparation review after correction ([15f294d](https://github.com/voidcorp-core/void-harness/commit/15f294dd93e220c2c7ad5717ffeb5e937e38d827))
* **controller:** separate preparation from implementation receipts ([d5e55e7](https://github.com/voidcorp-core/void-harness/commit/d5e55e7d1d5ab42cae52b23dad887884fd90e123))
* **derive:** declare presentation identifiers ([b558a19](https://github.com/voidcorp-core/void-harness/commit/b558a1930701f2ad29141914c0d873bab41cb65d))
* **doctor:** accept the merge gate the contract grants, and hold every surface to it ([03c363b](https://github.com/voidcorp-core/void-harness/commit/03c363bd43316e56e24e80606ef2c5b724924da2))
* **doctor:** judge the installation of the main checkout from a worktree ([1b5fe29](https://github.com/voidcorp-core/void-harness/commit/1b5fe29f9b2966b436cac2bf6a034478630fe61b))
* **doctor:** name the installation directory in every remedy printed from a worktree ([f0f7374](https://github.com/voidcorp-core/void-harness/commit/f0f73747eba4d5919524e1f3259887454ef999b5))
* **doctor:** name the paths looked at when no active program is found ([275f41e](https://github.com/voidcorp-core/void-harness/commit/275f41e8ad329d2248fb5b79a3b4b065a82da63e))
* **doctor:** prove with git that the paths a clone needs are not hidden ([ec24c1b](https://github.com/voidcorp-core/void-harness/commit/ec24c1bbefc905115ddbc74eee7f5e8aa7a0e6ce))
* **doctor:** the --fix branch names the installation like every line above it ([51b0a80](https://github.com/voidcorp-core/void-harness/commit/51b0a80aebc97e60868d8f234df5d23dd217eb64))
* **eval:** bind approval to packed artifact ([e2e430e](https://github.com/voidcorp-core/void-harness/commit/e2e430e6b29a9b0d7fa0e18beaf9495707177608))
* **eval:** bound Codex pilot output ([20ed679](https://github.com/voidcorp-core/void-harness/commit/20ed679698127119eac20545b788a7f9a0f24d34))
* **eval:** bound runtime event evidence ([557eaad](https://github.com/voidcorp-core/void-harness/commit/557eaad98f25680f8e6faa83f51dd5b4235f6a33))
* **eval:** canonicalize bounded capability before archive binding ([d6aeef4](https://github.com/voidcorp-core/void-harness/commit/d6aeef4705fed628c77117a061aceb2b1870401a))
* **eval:** discard verbose provider stderr safely ([18d0485](https://github.com/voidcorp-core/void-harness/commit/18d0485954f715feb8116df6f0f5e3d28e32b04b))
* **eval:** enable isolated codex authentication ([a9ff977](https://github.com/voidcorp-core/void-harness/commit/a9ff977856880ad004692a36f9c8652a98691d01))
* **eval:** make campaign execution end to end ([35edb8c](https://github.com/voidcorp-core/void-harness/commit/35edb8cf908bda5ba7676c5e42696b2ab0f7a2b4))
* **eval:** omit harness runtime cache from diffs ([c0aa915](https://github.com/voidcorp-core/void-harness/commit/c0aa9153cf0884d133b1be21822808d0ed65ab5f))
* **eval:** preserve multiline runtime prompts ([268e646](https://github.com/voidcorp-core/void-harness/commit/268e646c886c6b9e09d0dd876d0d66a794203127))
* **eval:** preserve uncertainty in total campaign cost ([f2d3be5](https://github.com/voidcorp-core/void-harness/commit/f2d3be5b442a280ebde2589132750412b23e403c))
* **eval:** prevent overlapping campaign runs ([baed2da](https://github.com/voidcorp-core/void-harness/commit/baed2dadfc4511a2e3953171fbae2f6cc9b33aa9))
* **eval:** refuse oversized condition prompts ([9292bcb](https://github.com/voidcorp-core/void-harness/commit/9292bcb3a7189523221c51fe86f12f859149e090))
* **eval:** retain reservations for unknown observations ([a4c7d08](https://github.com/voidcorp-core/void-harness/commit/a4c7d0853caf9bedd06d35dd83b4ee95a5ac7fd5))
* **eval:** retain source commit in consumer workspaces ([c1c2aff](https://github.com/voidcorp-core/void-harness/commit/c1c2aff5db2aa3e7a9ae086dacd0ef87552382a8))
* **eval:** track consumer cell baseline ([ec91af1](https://github.com/voidcorp-core/void-harness/commit/ec91af10b69ba3163e78d3576c152aed1e6da396))
* **eval:** withhold runtime transcript diagnostics ([e32a4b9](https://github.com/voidcorp-core/void-harness/commit/e32a4b97633733dfded0b3acd5d8c32853f3ff68))
* finish DEV-832 mission reliability flow ([06d86ea](https://github.com/voidcorp-core/void-harness/commit/06d86eac55e5a37ca4b185dc72ff5c2528c6aa6b))
* **graph:** count a line the way the floor counts it, so one rule has one measure ([032e81c](https://github.com/voidcorp-core/void-harness/commit/032e81c325ab65599d8d9f802ec7d615aaa2609c))
* **graph:** read complete SSE frames in live server tests ([cf07d79](https://github.com/voidcorp-core/void-harness/commit/cf07d79a1340098ad1829480d3dc99cd83675dd2))
* **hook-runner:** type the environment the fallback test builds, so every package typechecks ([a5e5d4b](https://github.com/voidcorp-core/void-harness/commit/a5e5d4bdfd671fab5c0c8c982c3f89168b2f8668))
* **hooks:** exempt a module that only re-exports from the sibling-test rule ([f22426f](https://github.com/voidcorp-core/void-harness/commit/f22426fa7acf5ba28ac1d9b9fe8f122fae1c16e2))
* **hooks:** preserve explicit deletion in tdd enforcement ([14dce32](https://github.com/voidcorp-core/void-harness/commit/14dce329d482faa910a59902efd49db41070370c))
* **install:** clean staging before the failure exit ([#336](https://github.com/voidcorp-core/void-harness/issues/336)) ([9b3004a](https://github.com/voidcorp-core/void-harness/commit/9b3004abda2a5647eab629e6e6e06efd08953fd1))
* **mechanisms:** three mechanisms that could not fire now say so or fire ([9e04753](https://github.com/voidcorp-core/void-harness/commit/9e04753c136cee3439a69624201ba07f24831fd4))
* **mission:** advance after preparation correction ([3d6f151](https://github.com/voidcorp-core/void-harness/commit/3d6f1516d6171efeb495bb039048840cd790825a))
* **mission:** advance after preparation correction ([f3e5189](https://github.com/voidcorp-core/void-harness/commit/f3e51890a99bf089bf022220e0848f2c8a853133))
* **mission:** bind review evidence to the anchored work content ([441fdce](https://github.com/voidcorp-core/void-harness/commit/441fdceea2f6920c025d26985c784db1a97385c9))
* **mission:** fail clearly without implementation base ([0c6ee46](https://github.com/voidcorp-core/void-harness/commit/0c6ee46ef1e3c56dca489fa5ecec6536c3216605))
* **mission:** fail clearly without implementation base ([8df7d30](https://github.com/voidcorp-core/void-harness/commit/8df7d306fedf95fac627990b7463ae40185cb7e4))
* **mission:** preserve review evidence across commits ([6aa7d31](https://github.com/voidcorp-core/void-harness/commit/6aa7d314e938a9b4d3fab713cc4669f7a8a5b57d))
* **mission:** preserve review stage after preparation correction ([5c20283](https://github.com/voidcorp-core/void-harness/commit/5c20283aa6dab2b0b5208b95827509fd3971ce1f))
* **mission:** preserve review stage after preparation correction ([cb4aa32](https://github.com/voidcorp-core/void-harness/commit/cb4aa3231af30dab990bc5541f0ae762b604ec3a))
* **mission:** read the panel and the journal from the installation root ([c0a8df0](https://github.com/voidcorp-core/void-harness/commit/c0a8df02bdb21b903818db3b5ff71525058d6c00))
* **mission:** retain implementation diff across review ([d2901e3](https://github.com/voidcorp-core/void-harness/commit/d2901e364508c80fda528d259574ed6e97094ee2))
* **project-graph:** make case probe fixture portable ([ba16744](https://github.com/voidcorp-core/void-harness/commit/ba1674410325ef93ea98502585c8ec72ac5dc773))
* **project-graph:** use Git null config path on Windows ([7ef0d73](https://github.com/voidcorp-core/void-harness/commit/7ef0d7394b41a57923f7d4bc6b2ced18835ee8e5))
* **promotion:** audit nested commits through their integration PR ([142352d](https://github.com/voidcorp-core/void-harness/commit/142352dd56c2a15636ba4c1389f3ceee7a254422))
* **promotion:** audit the exact develop integration for each commit ([24ad3f8](https://github.com/voidcorp-core/void-harness/commit/24ad3f849cbaefdf79107089005541309fc4e9d1))
* **release:** harden consumer updates and context enforcement ([d7c8221](https://github.com/voidcorp-core/void-harness/commit/d7c822154410032de2d38d7702f3d78a3fb544c0))
* **skills:** keep preparation path examples valid ([3f016cc](https://github.com/voidcorp-core/void-harness/commit/3f016ccae5e6c7d53a61b205c826723db08f5398))
* **status:** measure the installation root and persist the snapshot there ([6d5a725](https://github.com/voidcorp-core/void-harness/commit/6d5a7259027a0008162af66fb93810cb92d57e16))
* **status:** name the installation in the freshness notice and the snapshot path from a worktree ([deb5de7](https://github.com/voidcorp-core/void-harness/commit/deb5de7d93fc2648679ca30a667266ee0e41826a))
* **teardown:** remove active gstack runtime references ([411f595](https://github.com/voidcorp-core/void-harness/commit/411f5958d3d75fffec21b65cc940afa9180932f9))
* **testing:** bound complete stress seed range ([137892d](https://github.com/voidcorp-core/void-harness/commit/137892d81a34549123cd93fb2ccf1d6d9c44b994))
* **testing:** contain every run-owned side effect ([9c4005d](https://github.com/voidcorp-core/void-harness/commit/9c4005dc070cdcf1d4258ca5a7907c03cd1ab70f))
* **testing:** isolate Vitest worker groups ([4091b6c](https://github.com/voidcorp-core/void-harness/commit/4091b6c48b0f25feddd46b1ea60e50e1d39ebf8f))
* **testing:** prevent fresh-lock takeover and read complete SSE frames ([08d2e3e](https://github.com/voidcorp-core/void-harness/commit/08d2e3ee366e92e16b5da07d7b899d9cc0a60ce2))
* **testing:** restore reliable lock and streaming proofs ([d23dd38](https://github.com/voidcorp-core/void-harness/commit/d23dd38d264d22eec0215bf003e2a94826890a10))
* **update:** write the install receipt on the marketplace route too ([74bd178](https://github.com/voidcorp-core/void-harness/commit/74bd178671d8633d3f44eafcd51a8f69f2af13b9))
* **verify:** bound network admission and remove build IPC dependency ([5b0bf6f](https://github.com/voidcorp-core/void-harness/commit/5b0bf6fef31a305b6fa071b55da35d113b716134))
* vider la file Triage — merge gate, comptage de lignes, mécanismes muets, curseur de run ([1e01fc9](https://github.com/voidcorp-core/void-harness/commit/1e01fc9b42392d0a3fd562b6fa7b519457ceded0))


### Performance Improvements

* **test:** parallelize safe subprocess contracts ([a939c99](https://github.com/voidcorp-core/void-harness/commit/a939c99ff7f24c3a6b4fd92b131a4a57e3389d14))

## [3.6.0](https://github.com/voidcorp-core/void-harness/compare/v3.5.0...v3.6.0) (2026-09-02)


### Features

* **autopilot:** a range carrying another ticket's file does not merge ([d60d5d9](https://github.com/voidcorp-core/void-harness/commit/d60d5d99bac1074b5d3cc32166626cb2e6c991f1))
* **autopilot:** a run says what it keeps, and its debt travels bounded ([c3cd81e](https://github.com/voidcorp-core/void-harness/commit/c3cd81ea320e4a007c8b71356fb4cd3d88ea478d))
* **autopilot:** a run that died is not indistinguishable from one that is working ([0e19776](https://github.com/voidcorp-core/void-harness/commit/0e19776c9dcf8a29f2f6149258367ebe577e3e34))
* **autopilot:** bound a unit by turns and tokens beside the clock ([77ef88e](https://github.com/voidcorp-core/void-harness/commit/77ef88e2097cc46e8bc0d71778cfb6539e9b0c63))
* **autopilot:** bound the chain by time, which is what someone actually means ([1614ab1](https://github.com/voidcorp-core/void-harness/commit/1614ab1071f92bcbcd0aeec01240d92457482802))
* **autopilot:** declare what a unit owes, and refuse a proof nobody produced ([6a90a07](https://github.com/voidcorp-core/void-harness/commit/6a90a07e04efa2efd90e04eaa1fb5380d633bb10))
* **autopilot:** drain a pool for the declared duration, one implement per unit ([c42ca1d](https://github.com/voidcorp-core/void-harness/commit/c42ca1d68e4204366c3e473ab700d6e2df4f5d68))
* **autopilot:** drive the cycle from a script, so obedience stops standing in for a mechanism ([5786a7e](https://github.com/voidcorp-core/void-harness/commit/5786a7eaea1dc012690e65442ed5177109c4c708))
* **autopilot:** grade a union finding by consequence, so the gate can say yes ([e1e8e39](https://github.com/voidcorp-core/void-harness/commit/e1e8e39d65af38b6bfa43759c3b15ee7875e8c02))
* **autopilot:** grade a union finding by consequence, so the gate can say yes ([5aad74e](https://github.com/voidcorp-core/void-harness/commit/5aad74e4c3efadefc2698b03c244cb4bf97b9135))
* **autopilot:** le cycle est un script, et les vingt-sept mécanismes déclarés trouvent leur appelant ([c505e94](https://github.com/voidcorp-core/void-harness/commit/c505e946baba8ebdf23aa395363d25e3c345a440))
* **autopilot:** prove the brief preceded the code, from the stream not from a report ([4ac9930](https://github.com/voidcorp-core/void-harness/commit/4ac9930a9908ccc3462005ae87ee69513a004a91))
* **autopilot:** publication and the merge grant answer to a command ([c67d37c](https://github.com/voidcorp-core/void-harness/commit/c67d37c63d445076a213e2b3cd791a295f840c0c))
* **autopilot:** say how to obtain every field, not only which fields exist ([1e4eabd](https://github.com/voidcorp-core/void-harness/commit/1e4eabdab39efd16aab594260a950c8a4b7c4b26))
* **autopilot:** stop the chain the moment the base stops being trustworthy ([77548f0](https://github.com/voidcorp-core/void-harness/commit/77548f074c73e42e9e46ac875fee1e8c9070b9b1))
* **autopilot:** the cluster becomes worktrees and the workers become a merge ([3e16782](https://github.com/voidcorp-core/void-harness/commit/3e167828175f6d877fb45bfc9fb38348cc5da781))
* **autopilot:** the last six mechanisms find their caller, and a net keeps them ([ef171d8](https://github.com/voidcorp-core/void-harness/commit/ef171d8a98f330563a5779feeb9db9399c194546))
* **autopilot:** the machine prints the shape it accepts, so nobody reads the types ([f5af8a2](https://github.com/voidcorp-core/void-harness/commit/f5af8a27bd168df9dc2ed99407fd8fea982085a1))
* **autopilot:** the merge grant gets its missing guards, and the chain learns to stop ([296909d](https://github.com/voidcorp-core/void-harness/commit/296909dd947e4b9d6d801ad71cd2115ec4c6b9e5))
* **autopilot:** the plan denies a class of shared git state, not one command ([cb45ca0](https://github.com/voidcorp-core/void-harness/commit/cb45ca09b00cc4109461776f18ef1f7942af6b48))
* **autopilot:** un run mort ne ressemble plus à un run qui travaille ([5164943](https://github.com/voidcorp-core/void-harness/commit/5164943fd0c52ee1bf23a2a0847cff77665e985e))
* **autopilot:** what a unit owes is judged by a command, not by a paragraph ([fb7c328](https://github.com/voidcorp-core/void-harness/commit/fb7c328da15000df391bdba33705c14ae4503133))
* **cli:** refresh a project doctrine nobody ever wrote in ([ba564de](https://github.com/voidcorp-core/void-harness/commit/ba564defaa96ca70fbaf99c173a216afdc106ad9))
* **doctrine:** the installed project doctrine is a stub, not a form ([95411a8](https://github.com/voidcorp-core/void-harness/commit/95411a88395cf04a439e73e9ef99db9551780dde))
* **enforce:** refuse a control character written into a source file ([4fbe441](https://github.com/voidcorp-core/void-harness/commit/4fbe441c1c9917e51b74859e7165a6ada073c5df))
* **implement:** require the shipped surface to be run, on the real repository ([0bbf6f4](https://github.com/voidcorp-core/void-harness/commit/0bbf6f417a680dd319c65358d8046d467c9da43e))
* **mission:** compile the bounded pack a specialist reads instead of exploring ([ba966b0](https://github.com/voidcorp-core/void-harness/commit/ba966b0dd7a6c7f22bf1a45e6f72e9ca26a8945e))
* **skills:** a finding enters the work only by beating the work in progress ([b8a218c](https://github.com/voidcorp-core/void-harness/commit/b8a218ce57606e56cd4e63b60d3c0eba1041af32))
* **ticket:** search the tracker before writing a ticket, on the subject ([7d61f41](https://github.com/voidcorp-core/void-harness/commit/7d61f41f6d97dc0ce6bab4c45f6490f9f011032b))


### Bug Fixes

* **autopilot:** a carve-out is a boundary, and the wider area walked through it ([03dee6c](https://github.com/voidcorp-core/void-harness/commit/03dee6c7d071904a86a9a7612ce0de208dce350f))
* **autopilot:** a consent taken back stops the chain, instead of being ignored ([b43a242](https://github.com/voidcorp-core/void-harness/commit/b43a242c8b950538e15638db1c478567fe205894))
* **autopilot:** a directory written with a trailing slash claims what is under it ([6c2414e](https://github.com/voidcorp-core/void-harness/commit/6c2414edbd615232f6738f44371e499193feb667))
* **autopilot:** a dot is a character, not a category ([9d5f5a5](https://github.com/voidcorp-core/void-harness/commit/9d5f5a5fb6325239b1b7fa55939dfa6af3b28890))
* **autopilot:** a footprint for nobody is refused where both lists are in hand ([8daf8c6](https://github.com/voidcorp-core/void-harness/commit/8daf8c6de4adce59beaea0602449a2bcc9276cea))
* **autopilot:** a glob and a directory in one subtree are not two lanes ([12f02d5](https://github.com/voidcorp-core/void-harness/commit/12f02d53c1fddea928d687ce203fc983ffef1e8b))
* **autopilot:** a name in the subcommand table nobody routed released the lease ([4ff1923](https://github.com/voidcorp-core/void-harness/commit/4ff19232faaa94cb7f418481ac430e39dbc6d855))
* **autopilot:** a ref the grant cannot read refuses, instead of granting production ([745fe93](https://github.com/voidcorp-core/void-harness/commit/745fe930b81f21dc293c74dd52d2bd99b31273da))
* **autopilot:** an audit switched by one list is switched off by shortening it ([8542029](https://github.com/voidcorp-core/void-harness/commit/8542029456f27c41d844aa85b0dff17e21b22230))
* **autopilot:** an audit that can be omitted is an audit nobody can prove ran ([01cd83e](https://github.com/voidcorp-core/void-harness/commit/01cd83e02d8beea5faaa9b7b9c4df55b294f7c74))
* **autopilot:** close what the review panel found in the grading itself ([9a2aa2a](https://github.com/voidcorp-core/void-harness/commit/9a2aa2a25387454889c2d2898cec2236b439d4c6))
* **autopilot:** compare the deploying branch by identity, not by spelling ([31270bd](https://github.com/voidcorp-core/void-harness/commit/31270bd27a576ad17b717f1b3e17b1d6a1bd68b8))
* **autopilot:** eleven subcommands were handed an empty pipe, reconcile among them ([381d05d](https://github.com/voidcorp-core/void-harness/commit/381d05d2a756273caf6a77279fd141a3768abf68))
* **autopilot:** give the merge grant its missing refusals, and stop the skill lying about them ([9e41d21](https://github.com/voidcorp-core/void-harness/commit/9e41d214c01acd292d64b4539c7d94633c76634f))
* **autopilot:** le garde de merge refuse ce qui s'exécute, et un run ne démarre pas ce qu'il ne peut pas finir ([bd4bba1](https://github.com/voidcorp-core/void-harness/commit/bd4bba14caae61334355b550028fbf790f1a3fbc))
* **autopilot:** make the path guard match what it declares, and say so truthfully ([978d4da](https://github.com/voidcorp-core/void-harness/commit/978d4daa7262f19317597401e1c4b78b5e88e998))
* **autopilot:** shortening every list of a payload together still shortens the run ([fd0ee0b](https://github.com/voidcorp-core/void-harness/commit/fd0ee0b00464d5b110fb349196074b8de8a3c74c))
* **autopilot:** stop the chain on an observation about another tree ([9e1b198](https://github.com/voidcorp-core/void-harness/commit/9e1b198f4720d9a25f597771d87472f28c402859))
* **autopilot:** the Codex adapter learns the prohibition its own page claimed it had ([b1e02d1](https://github.com/voidcorp-core/void-harness/commit/b1e02d122b0f95a5da810672a1dea0162316acb6))
* **autopilot:** the human gate compares one identity, so a casing cannot lift it ([71d57c8](https://github.com/voidcorp-core/void-harness/commit/71d57c8e8b700e41a177bc26684eadac2549b250))
* **autopilot:** the merge guard refuses what runs, and a run does not start what it cannot finish ([353eecf](https://github.com/voidcorp-core/void-harness/commit/353eecf61891c1aa048674f8c43db2784e4ae328))
* **autopilot:** the refusal named the one move that turns the audit off ([0d1995d](https://github.com/voidcorp-core/void-harness/commit/0d1995d4f674a155fab83ecef7f074beeb9f0cc3))
* **autopilot:** the selector admitted a footprint the audit refuses to reconcile ([4aa4b3c](https://github.com/voidcorp-core/void-harness/commit/4aa4b3cbb1e5ee60dfa65220fb1c861804f8e550))
* **autopilot:** two comments promised a refusal the code answered with a TypeError ([f2168ab](https://github.com/voidcorp-core/void-harness/commit/f2168ab8fb950d671e7226b9249b5e5de7856299))
* **autopilot:** un consentement repris arrête la chaîne, au lieu d'être ignoré ([b7b1298](https://github.com/voidcorp-core/void-harness/commit/b7b12985a07876fbe1b68cd01a87c26860739139))
* **context:** a watchdog that cannot watch says so, instead of going quiet ([eb0b124](https://github.com/voidcorp-core/void-harness/commit/eb0b1247af0f27655460d9573def1a991215a116))
* **context:** give the unwatchable admission its own latch ([7d61a74](https://github.com/voidcorp-core/void-harness/commit/7d61a743701bde4d84ae319abce0969a70eb6c88))
* **doctrine:** answer the union review — supersede explicitly, and make the prefix real ([231864f](https://github.com/voidcorp-core/void-harness/commit/231864f6dfdad9c0e44b9815a1c185efccc7f70e))
* **harness-graph:** an observation anchors itself in the event stream ([f246caa](https://github.com/voidcorp-core/void-harness/commit/f246caa8035b6d82f79c0dab34c299093989d7b5))
* **harness-graph:** keep the loop alive while an observation waits for its anchor ([abd90ff](https://github.com/voidcorp-core/void-harness/commit/abd90ff5c64a0c8677fe7534697d1430d1627be6))
* **harness-graph:** la suite ne flake plus, parce que l'observation se synchronise avec son flux ([5304b12](https://github.com/voidcorp-core/void-harness/commit/5304b125ac66c0e3089d908266df590fdbf0d275))
* **init:** an unreadable settings.json is not an empty one ([53f95cf](https://github.com/voidcorp-core/void-harness/commit/53f95cfd0c15b4d1d894d90847a3e31d1a71e1f1))
* **init:** le bloc d'ignore ne nomme un agent qu'une fois que le reçu le possède ([21a4385](https://github.com/voidcorp-core/void-harness/commit/21a438508a0c616420e1d2e17b80df6e02d055e6))
* **init:** the ignore block names an agent only once the receipt owns it ([5031933](https://github.com/voidcorp-core/void-harness/commit/50319330ed07c2f3cc4edab0bf64e40474b428eb))
* **init:** un settings.json illisible n'est pas un settings.json vide ([fff3c23](https://github.com/voidcorp-core/void-harness/commit/fff3c2362b9cf9ae666100fbfd203390fa2b2433))
* **install:** stop --force from seizing the files the project co-owns ([0c31b90](https://github.com/voidcorp-core/void-harness/commit/0c31b9099865b915f455f927fd48443cc22d1bdf))
* **install:** stop the ignore block from hiding the skills a project wrote ([0b946e9](https://github.com/voidcorp-core/void-harness/commit/0b946e902b28aa6669523ed080b5d685c2733314))
* **mission:** a pre-implementation pack carries the ticket, not an absent diff ([8fa3ec0](https://github.com/voidcorp-core/void-harness/commit/8fa3ec0a3d10bbc8772a9d0da6ceb2d3448b0249))
* **mission:** close the five holes the panel found in its own pack ([4b8d031](https://github.com/voidcorp-core/void-harness/commit/4b8d031d0074ea61f7e4ea3f2c87a4cdf8306159))
* **test:** a filtered package run applies the same time limit as the full suite ([ee08fcd](https://github.com/voidcorp-core/void-harness/commit/ee08fcddb01021caf51ad19bd5694f9193734cbf))
* **verify:** the local proof covers the size ceiling CI enforces ([9f9f1f4](https://github.com/voidcorp-core/void-harness/commit/9f9f1f4cdd99ed8c5c7adf349bbba0dcefd18815))

## [3.5.0](https://github.com/voidcorp-core/void-harness/compare/v3.4.1...v3.5.0) (2026-08-29)


### Features

* audit findings — ignore rules out of .gitignore, union-read merge gate, per-runtime orchestration ([42fd718](https://github.com/voidcorp-core/void-harness/commit/42fd7180731f4617bf795e76c6172b291ab48c83))
* **autopilot:** ask the union reader, and stop its prose at the schema ([f30e89b](https://github.com/voidcorp-core/void-harness/commit/f30e89ba3b183cdaffbd316f4ddcdc6522d770cf))
* **autopilot:** decide the merge only once the checks have spoken ([add1fe6](https://github.com/voidcorp-core/void-harness/commit/add1fe62c2487dcb7266d885f453308167b12663))
* **autopilot:** instruct the runtime to read the union before it merges ([ad726d2](https://github.com/voidcorp-core/void-harness/commit/ad726d2ab27a3f87c16f82045efe18cd34a61c1c))
* **autopilot:** judge whether an integrated union may merge itself ([ce9e35c](https://github.com/voidcorp-core/void-harness/commit/ce9e35c84aaef143050f60d76af3bd4ac64c75ef))
* **autopilot:** let a program declare the union-reviewed merge gate ([3efff9d](https://github.com/voidcorp-core/void-harness/commit/3efff9df036cdc66a5f36409a75f3ff674fdcf84))
* **autopilot:** point the --auto-merge refusal at the durable declaration ([95fee53](https://github.com/voidcorp-core/void-harness/commit/95fee532ea9f1b85e7e9ec027e52003dcf53b364))
* **autopilot:** read the union as wide as the runtime can argue ([bea5b67](https://github.com/voidcorp-core/void-harness/commit/bea5b674c21059b13fefcfd51431f9fb9fa9d739))
* **autopilot:** remove the enabled flag; the block is the consent ([9ae5e21](https://github.com/voidcorp-core/void-harness/commit/9ae5e213184c3be29ab57ec785b7ff5498872247))
* **context:** nudge semantic checkpoints at a reliable threshold ([db79f29](https://github.com/voidcorp-core/void-harness/commit/db79f29d56529e6d09d4ca9596beb64f38c71d1a))
* **context:** preserve mechanical state before compaction ([3333c32](https://github.com/voidcorp-core/void-harness/commit/3333c32bf287d32d392f7efe3ce9194c5fc13586))
* **context:** track the bounded working set across sessions ([7ab4baa](https://github.com/voidcorp-core/void-harness/commit/7ab4baae78eeb51ba7466491941cb3c5f16b2ca6))
* **context:** unify program resume and mechanical continuity ([#283](https://github.com/voidcorp-core/void-harness/issues/283)) ([2a40ad0](https://github.com/voidcorp-core/void-harness/commit/2a40ad0a9dfc9577b7fd93f7f139086ac92e8a60))
* **decisions:** distinguish references from decision content ([2cda4ec](https://github.com/voidcorp-core/void-harness/commit/2cda4ec3c914810abe1b4972c276d856d578dd23))
* **freshness:** make the session banner ask for the upgrade to be relayed ([80ef00e](https://github.com/voidcorp-core/void-harness/commit/80ef00e59f5d2834a11f7416085ccf1157205dcf))
* **hooks:** inject resume context and checkpoint reminders ([e0b52ac](https://github.com/voidcorp-core/void-harness/commit/e0b52acb83fe43618cb6e9a7d9d131920b57bb81))
* **install:** move the ignore rules to the repository exclude file ([b24cbc1](https://github.com/voidcorp-core/void-harness/commit/b24cbc1f954c3bf78db03c23bb45a86adea5a9de))
* **install:** write the ignore rules where no checkout can revert them ([134832c](https://github.com/voidcorp-core/void-harness/commit/134832c206dba13610a61cf816a5544afa60d168))
* **mission:** plan how wide the specialist lenses run on this runtime ([6e7a155](https://github.com/voidcorp-core/void-harness/commit/6e7a15509f8566ceaca476068b2e693b8c377d17))
* **orchestration:** take each runtime to its maximum, degrade rather than block ([5047c5b](https://github.com/voidcorp-core/void-harness/commit/5047c5b812979d52de473d334b8d40f099d2c637))
* **program:** make program.md the durable descriptor ([2ea431e](https://github.com/voidcorp-core/void-harness/commit/2ea431eb735833e43b6f1c6be6cd0d60abe8cf0a))
* **resume:** compose program checkpoint and git state ([500e17a](https://github.com/voidcorp-core/void-harness/commit/500e17aa9861434904ea9ad91f84645f6f1c0cf6))
* **runtime:** observe what each runtime can do, in the one place a name appears ([b5a4868](https://github.com/voidcorp-core/void-harness/commit/b5a4868f6803ec2396f41b3778691435ea09d5f7))


### Bug Fixes

* **context:** abandon failed recovery claims ([90194cb](https://github.com/voidcorp-core/void-harness/commit/90194cb025a54949046765a969c3846e7a6e4f35))
* **context:** benchmark the shipped lifecycle hook ([4bfc36e](https://github.com/voidcorp-core/void-harness/commit/4bfc36e48bc3d67d72fe113f9a57234f3551ae5f))
* **context:** fence stale recovery by generation ([47bed9e](https://github.com/voidcorp-core/void-harness/commit/47bed9e4202bf0a5c0c9b15dbfee95ea4a9e13d4))
* **context:** fence stale takeover atomically ([d13f5df](https://github.com/voidcorp-core/void-harness/commit/d13f5df8661fae48c919b26fb5e3e0cd2d7d97fb))
* **context:** harden continuity failure boundaries ([a28d991](https://github.com/voidcorp-core/void-harness/commit/a28d991f2d15a1093937f769dce7a8c6ec50d0de))
* **context:** preserve the elected recovery claim ([8e874e8](https://github.com/voidcorp-core/void-harness/commit/8e874e8d67a557ed4492f355cc69942cd5867ba2))
* **context:** recognize repeated resume cycles ([d780269](https://github.com/voidcorp-core/void-harness/commit/d7802692586bb18a45dbc02074795f9a4504f26e))
* **context:** recover continuity locks after crashes ([748a9b4](https://github.com/voidcorp-core/void-harness/commit/748a9b4758429a840664679dd17efb97d37d2693))
* **context:** serialize continuity recovery safely ([6a5cb5d](https://github.com/voidcorp-core/void-harness/commit/6a5cb5d6ea1625932a8985013788d1af95e759ea))
* **context:** stabilize causal hook benchmark ([fee2379](https://github.com/voidcorp-core/void-harness/commit/fee23794a2ede9c8bf9180417429848c7a93b7a0))
* **decisions:** fail closed on unsafe ancestors ([25a32c5](https://github.com/voidcorp-core/void-harness/commit/25a32c53346f206d9231de15bd321f5f31af2ad7))
* **decisions:** validate declared runtime references ([f097cf0](https://github.com/voidcorp-core/void-harness/commit/f097cf06d70422494f74655c228cb5b051496c37))
* **doctor:** name the rollback the manifest cannot see ([8911e83](https://github.com/voidcorp-core/void-harness/commit/8911e834f492b4b9c0ef3f8c6c046f542101f2df))
* **doctor:** resolve effective Biome file scope ([74f3c69](https://github.com/voidcorp-core/void-harness/commit/74f3c697ea04f83c33654e2ea48a2bc18c6d9f73))
* **layout:** classify the canonical program descriptor ([8fb4909](https://github.com/voidcorp-core/void-harness/commit/8fb4909669b7a440c70feec9bc275ed62a7bfa30))
* **layout:** remove the managed block without disturbing its neighbours ([ce3133b](https://github.com/voidcorp-core/void-harness/commit/ce3133bd46e4a130d0e3ee0a208f673adf9504d5))

## [3.4.1](https://github.com/voidcorp-core/void-harness/compare/v3.4.0...v3.4.1) (2026-08-21)


### Bug Fixes

* **release:** accept npm JSON errors from stdout ([a691d7c](https://github.com/voidcorp-core/void-harness/commit/a691d7c8145dc4603e18f82ebb3c7f7c4dda5d31))
* **release:** classify npm 11 JSON errors from stdout ([e870536](https://github.com/voidcorp-core/void-harness/commit/e870536d245711cc3657e5b8af0515b5773ad3d3))

## [3.4.0](https://github.com/voidcorp-core/void-harness/compare/v3.3.0...v3.4.0) (2026-08-21)


### Features

* **mission:** close specialist feedback loop ([c386386](https://github.com/voidcorp-core/void-harness/commit/c386386f469e07312c8ba10fd7f679fd2ba2b586))
* **mission:** expose specialist dispatch contract ([609b00d](https://github.com/voidcorp-core/void-harness/commit/609b00d2a9fb22d4bcf6a4d1326a4fd931b5df45))
* **release:** bind minimal OIDC publish to public provenance ([7002419](https://github.com/voidcorp-core/void-harness/commit/7002419239f5f1d6732797c4a2e69a33716399ed))
* **release:** pack the exact release tree without OIDC ([6727e66](https://github.com/voidcorp-core/void-harness/commit/6727e66421434148fa5c2145d55015ebf8a788d5))


### Bug Fixes

* **ci:** defer runner paths until steps start ([f9430e7](https://github.com/voidcorp-core/void-harness/commit/f9430e7e745b01c2e1ec40511f4047f09e7735af))
* **ci:** defer runner paths until steps start ([aa06431](https://github.com/voidcorp-core/void-harness/commit/aa06431027403379d711f676e0e16c0b664ecaca))
* **ci:** pin every effective workflow dependency ([0d0ce29](https://github.com/voidcorp-core/void-harness/commit/0d0ce29bb2204543c84aa3e579e86c79c4a34684))
* **cli:** dire a hydrate ce qu il absorbe, et prouver doctor au bon niveau ([835a8ba](https://github.com/voidcorp-core/void-harness/commit/835a8baac3fd7b16024be24e4f390bdee80a8749))
* **cli:** rapporter une edition de fichier co-possede comme telle, pas comme derive ([befd1d4](https://github.com/voidcorp-core/void-harness/commit/befd1d476b0b9a639cce2ba5dbafe0b83ddd532b))
* **release:** bind promotion and back-merge identity ([b61fc0d](https://github.com/voidcorp-core/void-harness/commit/b61fc0d57bdfd242067396b78f815a354bfcee9d))
* **release:** enforce the npm trusted publishing floor ([8b4a8e0](https://github.com/voidcorp-core/void-harness/commit/8b4a8e01370bb2ae9dc39ab74df7f016964cf469))
* **release:** execute bounded release boundary checks ([88c8858](https://github.com/voidcorp-core/void-harness/commit/88c88581ef73966e4696d08bdec2fc7448397d3a))
* **release:** prove the executed artifact verifiers ([7b007ef](https://github.com/voidcorp-core/void-harness/commit/7b007ef97fd5dc6673a9e948cdb042feb4883baa))
* **release:** separate workflow and release provenance SHAs ([6357d2b](https://github.com/voidcorp-core/void-harness/commit/6357d2bad2866815f29cf0a9921659c77509ab78))
* **release:** verify the original publication execution ([43c6f3c](https://github.com/voidcorp-core/void-harness/commit/43c6f3ca8bd1c82b6a60c4294be751c2d88d3a98))
* **skills:** enforce the two-level discovery description budget ([a8fdbd2](https://github.com/voidcorp-core/void-harness/commit/a8fdbd28169df969d29cde031cb0e8927f59d8a8))
* **skills:** parse discovery descriptions at canonical boundaries ([68c05d3](https://github.com/voidcorp-core/void-harness/commit/68c05d3c7660011eda738c673cae9dcc56ebce82))
* **telemetry:** recognize real agent usage ([8b53f8f](https://github.com/voidcorp-core/void-harness/commit/8b53f8f40b68f0562c13fa63f306e445744cf38e))

## [3.3.0](https://github.com/voidcorp-core/void-harness/compare/v3.2.0...v3.3.0) (2026-08-21)


### Features

* **scripts:** consigner et garder toute reference du code a une skill ([c3d5445](https://github.com/voidcorp-core/void-harness/commit/c3d54458665623c5a3e148ae4e18dc7ff722452b))


### Bug Fixes

* **cli:** reparer l'install cassee par le prefixe void- sur les skills ([b82349f](https://github.com/voidcorp-core/void-harness/commit/b82349f0fa6465d9f66571f1144e9676ef70e700))
* **doctor:** un renommage que plus rien n'appelle n'est pas un défaut ([aaac616](https://github.com/voidcorp-core/void-harness/commit/aaac616efa6e1e2855242748d7f23a64e2559999))
* **doctor:** un renommage que plus rien n'appelle n'est pas un défaut ([326a6d6](https://github.com/voidcorp-core/void-harness/commit/326a6d6ccec3a6225ca36598e7a41e6364519859))
* **hooks:** le dépôt ne choisit plus librement ce que le hook Stop exécute ([605db3c](https://github.com/voidcorp-core/void-harness/commit/605db3c9aa4136d91b860864695802de39d56381))
* **hooks:** le dépôt ne choisit plus librement ce que le hook Stop exécute ([878e243](https://github.com/voidcorp-core/void-harness/commit/878e2432ddeca516e4dafd55cb536f85ceaf39aa))
* **install:** un projet qui a déjà des skills peut installer le harnais ([6e61e6a](https://github.com/voidcorp-core/void-harness/commit/6e61e6a868355179ca623b044e6b05e66b5e9577))
* **install:** un projet qui a déjà des skills peut installer le harnais ([357493f](https://github.com/voidcorp-core/void-harness/commit/357493fae08a0fa0741f5c3e9a9dacda194f1582))
* **skills:** finir le balayage des references laissees nues par le prefixe ([e5fcf61](https://github.com/voidcorp-core/void-harness/commit/e5fcf617a74b4062716f6fadf6e45a312d77daa7))


### Reverts

* **mission-engine:** rendre la fixture d evenements a son etat d origine ([1a9beb8](https://github.com/voidcorp-core/void-harness/commit/1a9beb82250768eb1713c6148eebf7755e9b599d))

## [3.2.0](https://github.com/voidcorp-core/void-harness/compare/v3.1.1...v3.2.0) (2026-08-20)


### Features

* **implement:** l'anti-rustine devient une passe du cycle ([9b77aca](https://github.com/voidcorp-core/void-harness/commit/9b77aca771533d0af74482f1105adb06f7550b37))
* **implement:** l'anti-rustine devient une passe, au lieu d'un texte que rien ne rejoue ([f178e3e](https://github.com/voidcorp-core/void-harness/commit/f178e3e83794ccca1a356461f193990b22cf354f))


### Bug Fixes

* **install:** un asset identique à notre propre sortie nous appartient ([fd80f35](https://github.com/voidcorp-core/void-harness/commit/fd80f35e1727911813e70f88dc3c116612f8ac43))
* **invocation:** le verdict ne juge plus les skills qui ne sont pas les nôtres ([c81757a](https://github.com/voidcorp-core/void-harness/commit/c81757a9ab56f767359e51287e0153ac5b663873))
* **invocation:** ne juger que les noms qui furent les nôtres, et nommer leur successeur ([6c790fd](https://github.com/voidcorp-core/void-harness/commit/6c790fd92fa06de8cca9f6fd3741dacfae2201ed))
* **release:** ne publier que depuis main, depuis un SHA explicite, sous environnement ([f25183d](https://github.com/voidcorp-core/void-harness/commit/f25183dda161ec8ec332b1e3656f86795c7c11c4))
* **release:** ne publier que depuis main, sous environnement protégé ([dbe663c](https://github.com/voidcorp-core/void-harness/commit/dbe663cf990e0d01d499ef7663028963efb67830))
* **test:** ne pas exporter depuis un fichier de test ([31b7398](https://github.com/voidcorp-core/void-harness/commit/31b7398b70681789e79092185f3876a58d3c2c84))
* **update:** compléter un receipt amputé depuis le manifeste committé ([537a2ff](https://github.com/voidcorp-core/void-harness/commit/537a2ff6b2b140d6710de0a9c59428518aa142c7))
* **update:** la reprise depuis le manifeste ne revendique que le contenu qu'il atteste ([7e5fd9e](https://github.com/voidcorp-core/void-harness/commit/7e5fd9ec285ab74c6906e4f172e94d5cfeeb1014))
* **update:** ne revendiquer d'un chemin du manifeste que le contenu qu'il atteste ([d740d1b](https://github.com/voidcorp-core/void-harness/commit/d740d1ba3fcd3c5d4073cfe517647482b6230965))
* **update:** un receipt amputé ne bloque plus la mise à jour d'un consommateur ([9a0efdb](https://github.com/voidcorp-core/void-harness/commit/9a0efdb6e6e6fb20be2f66f215b982918078d886))

## [3.1.1](https://github.com/voidcorp-core/void-harness/compare/v3.1.0...v3.1.1) (2026-08-19)


### Bug Fixes

* **cli:** un update depuis un clone frais ne demande plus deux commandes ([ce5097b](https://github.com/voidcorp-core/void-harness/commit/ce5097bf314f7ebfcd41111cf99fd79d4a05c32f))
* **cli:** un update sans encombre, et une alerte qui peut s'éteindre ([80ee1eb](https://github.com/voidcorp-core/void-harness/commit/80ee1eb07ed41119b5be04d41cfa5a433dad6788))
* **hooks:** juger l'état présent, pas l'histoire du journal ([ce8670a](https://github.com/voidcorp-core/void-harness/commit/ce8670aca75006e629c3d9762f7806c21aa4b5a1))
* **install:** 148 lignes d'ignore pour deux fichiers, c'était la mauvaise forme ([d6a64f7](https://github.com/voidcorp-core/void-harness/commit/d6a64f7f48654b8e04da36e3e51b9a33f92b78a0))
* **install:** 148 lignes d'ignore pour deux fichiers, c'était la mauvaise forme ([dd1f8dc](https://github.com/voidcorp-core/void-harness/commit/dd1f8dcae2cee685544a1acb1f01085628f12b84))

## [3.1.0](https://github.com/voidcorp-core/void-harness/compare/v3.0.0...v3.1.0) (2026-08-19)


### Features

* **cli:** render the skill namespace from the install channel, not the runtime ([a396f51](https://github.com/voidcorp-core/void-harness/commit/a396f51fb1dacc40dd75cc2156c211e19e2e4c0c))
* **doctor:** rendre le détail des deux verdicts d'invocation ([73291ec](https://github.com/voidcorp-core/void-harness/commit/73291ec12f5d21a9afbdf6218ed2b75e40cfd521))
* **hooks:** détacher l'alerte du plancher et la rendre en bloc ([11cd48a](https://github.com/voidcorp-core/void-harness/commit/11cd48a7984880ec979705d729f3080491f13bff))
* **hooks:** dire à l'ouverture d'une session qu'un nom ne résout plus ([c264de2](https://github.com/voidcorp-core/void-harness/commit/c264de2a65bda8f1def64f8f1d2f57d6948746de))
* **hooks:** être prévenu quand la surface d'invocation redevient morte ([32b4441](https://github.com/voidcorp-core/void-harness/commit/32b4441c93a3c963a6ec6fb7d2d9a2ae4e4780b7))
* **hooks:** name the doctrine a refusal comes from ([5a3aead](https://github.com/voidcorp-core/void-harness/commit/5a3aead78b5eb70e9229d4f10b448fd5348fa8ed))
* **hooks:** signaler un silence, et dire ce qu'il couvre vraiment ([4c6976a](https://github.com/voidcorp-core/void-harness/commit/4c6976aa6e658f58777d06394503306597ee1a3a))
* **scripts:** refuse a namespaced skill reference in a live surface ([7922549](https://github.com/voidcorp-core/void-harness/commit/792254981fe048afe3849c96f02618bf65a620ef))
* **skills:** every gesture is a skill, so Codex and Kimi receive them too ([2fafc1a](https://github.com/voidcorp-core/void-harness/commit/2fafc1aa5f9f3926821330f7a154bc3f8f08a12c))
* **skills:** merge, pour vider une file de PR sans casser le dépôt ([b3365ed](https://github.com/voidcorp-core/void-harness/commit/b3365ed01f30ee1d3ce0a924592da88a73bac4a2))
* **skills:** merge, pour vider une file de PR sans casser le dépôt ([0fc1c40](https://github.com/voidcorp-core/void-harness/commit/0fc1c4084107c9c4ce00a956f29382c226fcd00b))


### Bug Fixes

* **ci:** make back-merge.yml parseable, and check that workflows parse ([ec57488](https://github.com/voidcorp-core/void-harness/commit/ec574885fba628a41174481cb6fa623ccd75f6a6))
* **ci:** rendre back-merge.yml analysable, et vérifier que les workflows le sont ([153c4fd](https://github.com/voidcorp-core/void-harness/commit/153c4fd14f5652e92859fc1bb65ad5fdd8623983))
* **cli:** un update finit ce qu'il peut, et le dit ([bda4265](https://github.com/voidcorp-core/void-harness/commit/bda426506da5f0cdabd3ea83924caebabb9e77f8))
* **graph:** livrer un journal de démonstration, pas celui de la machine qui build ([b7d5109](https://github.com/voidcorp-core/void-harness/commit/b7d51096f9f02e24e8427ffbfa10240c8ad91b81))
* **graph:** un artefact livré ne doit rien devoir à la machine qui l'a compilé ([cdba44e](https://github.com/voidcorp-core/void-harness/commit/cdba44e03916ed9ce21b6ecd735b87cfcbb8b0bb))
* **hooks:** typer l'énumération des skills et tenir la surface du paquet ([e454097](https://github.com/voidcorp-core/void-harness/commit/e4540973ae996f4df5cdf50c9a07efed06299f43))
* **skills:** cesser de prescrire le format de décision que le harnais a retiré ([d64114b](https://github.com/voidcorp-core/void-harness/commit/d64114bd3209fd359f732c2900125ab81e5652ea))
* **skills:** cesser de prescrire le format de décision que le harnais a retiré ([6590090](https://github.com/voidcorp-core/void-harness/commit/6590090b705109ed6f50edc2209ddea513aee139))
* **skills:** name the neighbouring skill, not its plugin invocation syntax ([e40d199](https://github.com/voidcorp-core/void-harness/commit/e40d199f7dffc7f47070219d0cff9cc4a9661ffb))
* **skills:** ne parler d'un marketplace que si l'install en vient ([8d12dba](https://github.com/voidcorp-core/void-harness/commit/8d12dbae84cac17f23da144ffd3aa679eacfa68c))
* **skills:** one slash command name, one owner ([829e0f5](https://github.com/voidcorp-core/void-harness/commit/829e0f5aae9336b295897d6ef3d2a4365093f32f))
* **skills:** un nom de slash command, un seul propriétaire ([4421d00](https://github.com/voidcorp-core/void-harness/commit/4421d00d4386db48c4cc875e7bf83594bf6c77ac))
* **specialists:** drop the MCP degradation, which the runtime never had ([cbeff28](https://github.com/voidcorp-core/void-harness/commit/cbeff28cb8da0e8bc97bcb60bec9de1b927949d4))
* **specialists:** retirer la dégradation MCP, que le runtime n'a jamais eue ([49d378f](https://github.com/voidcorp-core/void-harness/commit/49d378f064743a5e8e77d5dd22791d8f8d637751))


### Performance Improvements

* **hooks:** lire le verdict au lieu de le calculer à chaque ouverture ([3725428](https://github.com/voidcorp-core/void-harness/commit/3725428e9457a3b31157e691d887aeee87905c76))

## [3.0.0](https://github.com/voidcorp-core/void-harness/compare/v2.7.0...v3.0.0) (2026-08-18)


### ⚠ BREAKING CHANGES

* thirteen skills were renamed and resolve to nothing under their previous names, with no alias: brainstorming, writing-plans, ticket-writer, ticket-runner, verification-before-completion, systematic-debugging, learning-capture, adr-workflow, refactoring, accessibility-first, context-management, claude-md-authoring and migrations-safety became brainstorm, plan, ticket, implement, verify, debug, learn, decide, refactor, accessibility, context, claude-md and migrations. The layout under .void/ also moved into three named levels, which `update` migrates. See docs/MIGRATING-3.0.md.

### Features

* **chain:** notice the design, write it down, and link it to its ticket ([cbe8497](https://github.com/voidcorp-core/void-harness/commit/cbe8497595ac12a91646004f5f0816f8a5578108))
* **ci:** refuse a reference that points at a skill which does not exist ([b430412](https://github.com/voidcorp-core/void-harness/commit/b43041244453f03b1e550ecd997b928827e4c718))
* **doctor:** ask git what it ignores, not the .gitignore what it says ([dc70d6f](https://github.com/voidcorp-core/void-harness/commit/dc70d6fb9278d41484a5e8b8ae6a0537d3c9503d))
* **doctor:** find the harness assets the manifest lost track of, by provenance ([81a976f](https://github.com/voidcorp-core/void-harness/commit/81a976fe53e972defe51ee4e1bf4603c53bad8ed))
* **skills:** declare each skill's kind, so the naming rule can be checked ([e4b1b43](https://github.com/voidcorp-core/void-harness/commit/e4b1b4369a4dd7ce648313ce27592acbda2cf069))


### Bug Fixes

* **ci:** answer .void paths from the layout table, not from the disk ([32a3811](https://github.com/voidcorp-core/void-harness/commit/32a3811d857948c5eb84f0b04f02c3131ee08eda))
* **ci:** decide the back-merge on content, not on a commit count ([abd1031](https://github.com/voidcorp-core/void-harness/commit/abd1031b8d13069bffcc0c673e919332c82ddeb0))
* **doctor:** accept an explicit undefined under exactOptionalPropertyTypes ([82435ca](https://github.com/voidcorp-core/void-harness/commit/82435ca3f7519de4badd16fdac454db34577b7f2))
* **doctor:** report the version gap instead of blaming the layout ([1bdf557](https://github.com/voidcorp-core/void-harness/commit/1bdf557751f05f64b4facc191ec598847030421b))
* **doctor:** signaler l'écart de version au lieu d'accuser le layout ([038cee0](https://github.com/voidcorp-core/void-harness/commit/038cee08fa41e9df649e1b5ce021d2d64a260447))
* **enforcement:** see the writes the floor was never shown ([3a3abcf](https://github.com/voidcorp-core/void-harness/commit/3a3abcff27b6af930b3c3d3de3545f1296d21399))
* **hooks:** regenerate the catalogue instead of remembering to ([9866432](https://github.com/voidcorp-core/void-harness/commit/986643222fe1020d7edbe0edca748c3a0019f329))
* **hooks:** regenerate the certification manifest too ([0bb1101](https://github.com/voidcorp-core/void-harness/commit/0bb11010a08060727c0e8928cd0f1383946918dc))
* **layout:** route the last observed writers to machine/, and cover the flat paths ([1a2d743](https://github.com/voidcorp-core/void-harness/commit/1a2d74390fba6991669febd43573512f2c1d8c18))
* **repo:** close the four residues the layout audit left standing ([eda8f6b](https://github.com/voidcorp-core/void-harness/commit/eda8f6bc86a175891e6ee7a7ef1bfbf1f1ac91e4))
* **update:** stop guessing on a clone, and say what was kept behind ([aff01c2](https://github.com/voidcorp-core/void-harness/commit/aff01c271d665ea17e05bf0782a5aed4fcd933c4))


### Documentation

* write the 3.0 migration, and say the rename is breaking ([898c34d](https://github.com/voidcorp-core/void-harness/commit/898c34d75634dc8a2cd2874d5f4c05fd494b2e33))

## [2.7.0](https://github.com/voidcorp-core/void-harness/compare/v2.6.0...v2.7.0) (2026-08-18)


### Features

* **doctor:** retire the pre-journal streams, and write down the layout rule ([0808cff](https://github.com/voidcorp-core/void-harness/commit/0808cffb59353ba347194371075691bf94ba58b2))
* **layout:** ranger .void en trois niveaux nommés, avec migration (DEV-631) ([af58008](https://github.com/voidcorp-core/void-harness/commit/af580087fe73fe28227709276411880c08163e1c))
* **layout:** three named levels in .void, and a migration that renames ([3abf42f](https://github.com/voidcorp-core/void-harness/commit/3abf42f0be2bc4f796d7f4b23001e39265fb2651))


### Bug Fixes

* **cli:** make update honour --force, so its own remedy can be applied ([0c26b29](https://github.com/voidcorp-core/void-harness/commit/0c26b29ab1baa6f36de3baefe30cdeb7b0432427))
* **cli:** update honore --force, pour que son propre remède soit applicable ([fb976cb](https://github.com/voidcorp-core/void-harness/commit/fb976cb98a6119b1aed1e63bdef6b60cc4843692))
* **layout:** autonomous-runs holds plans, not machine state ([ccc8b4b](https://github.com/voidcorp-core/void-harness/commit/ccc8b4b6af763688001e8fa791af2b9927ad75b4))
* **layout:** keep the runner committed, and file the doctrine under installed/ ([a76a6e8](https://github.com/voidcorp-core/void-harness/commit/a76a6e827adefa42ea8f1f046496f988d383f6d2))
* **test:** point the checkpoint skill test at the renamed skill ([359a615](https://github.com/voidcorp-core/void-harness/commit/359a615a8fb3d788513eda9e860aa82d5d35ba1c))
* **update:** drop restorable content instead of relocating it ([612fbb4](https://github.com/voidcorp-core/void-harness/commit/612fbb4e057611473902502eacd66b99a7ca28f1))
* **update:** empty the previous machine directory whole, and file dead streams apart ([45d9bbf](https://github.com/voidcorp-core/void-harness/commit/45d9bbf96df665baf0294eb3575e0a0e21e328e1))
* **update:** migrate the legacy .void layout instead of reporting it forever ([41a3546](https://github.com/voidcorp-core/void-harness/commit/41a354607426b1dd9ad5f753c478905e582e5384))
* **update:** supprimer le restaurable au lieu de le déplacer (DEV-631) ([a80537b](https://github.com/voidcorp-core/void-harness/commit/a80537b5c264d84d5d989229270fd736319928d8))

## [2.6.0](https://github.com/voidcorp-core/void-harness/compare/v2.5.1...v2.6.0) (2026-08-17)


### Features

* **cli:** ask the project graph in paths, and never present a partial answer as complete ([57b58c4](https://github.com/voidcorp-core/void-harness/commit/57b58c404382705acf7c6a530dca72fa127acfb9))
* **cli:** report an unfollowable edge against the files in the answer, not the whole project ([9158b94](https://github.com/voidcorp-core/void-harness/commit/9158b940d845e8c587e979c00d8d9f80ac8e5266))
* **cli:** serve the projects view on localhost with void-harness ui ([bc4c48f](https://github.com/voidcorp-core/void-harness/commit/bc4c48f00933b7d4b2dd218361d135ef661f5c07))
* **cli:** show every Void project and where attention is owed ([cb2b1ae](https://github.com/voidcorp-core/void-harness/commit/cb2b1aed054b3486b4f966d69a8fec647a25fb02))
* **cli:** void-harness projects, le parc et ce qui mérite attention (DEV-622) ([3d295c0](https://github.com/voidcorp-core/void-harness/commit/3d295c0e2a0a916cf1b7f883a3ddb3b3d6ea3295))
* **cli:** void-harness resume, la reprise depuis le checkpoint (DEV-621) ([4dbd1f4](https://github.com/voidcorp-core/void-harness/commit/4dbd1f4d020808efe93ab46012cf8912c10025da))
* **cli:** void-harness resume, pick a project back up from its checkpoint ([3c97ce0](https://github.com/voidcorp-core/void-harness/commit/3c97ce0bb6f8cd0bdbd12c10b408aff6808cdb4f))
* **doctor:** conformité structurelle avec réparation (DEV-628) ([13a894d](https://github.com/voidcorp-core/void-harness/commit/13a894dc289e0531a9721e822795abb4402aa080))
* **doctor:** report structural drift and repair it with --fix ([2414c8e](https://github.com/voidcorp-core/void-harness/commit/2414c8e2f3b128d16324d6cf0306a2f5d0565f19))
* **graph:** a renamed path answers for what it became, proved against a real extraction ([f677e44](https://github.com/voidcorp-core/void-harness/commit/f677e446d8ef77772282530b9ae02c96a117672d))
* **graph:** the seven ProjectGraph queries, bounded and honest about what they do not know ([f5b47a4](https://github.com/voidcorp-core/void-harness/commit/f5b47a4bb4002ab66202f83c4b7b2834841491bc))
* **graph:** the seven ProjectGraph queries, their CLI surface, and what the benchmark does not cover ([88f4e4a](https://github.com/voidcorp-core/void-harness/commit/88f4e4a3ab323a7088f88adf22297a99c818dcf1))
* **hydrate:** an exact manifest, and a restore that proves itself ([1bda140](https://github.com/voidcorp-core/void-harness/commit/1bda14052daef15bd32210d895ca89b7f8bdb9fc))
* **hydrate:** an exact manifest, and a restore that proves itself ([10a1b03](https://github.com/voidcorp-core/void-harness/commit/10a1b03c8cb8e94f989952ebfe31c1caab94124a))
* **layout:** reopen the derived decision, now that hydrate can prove the restore ([9d3352a](https://github.com/voidcorp-core/void-harness/commit/9d3352ab33fed9141cd4ddca3b2aa8a8066d88b9))
* **layout:** reopen the derived decision, now that hydrate can prove the restore ([b959c7f](https://github.com/voidcorp-core/void-harness/commit/b959c7f2faa248f7f7236c7a23e3de5bd9eda34e))
* **layout:** split .void by ownership so what ships is what the project wrote ([9ca1c6a](https://github.com/voidcorp-core/void-harness/commit/9ca1c6a5c58e1b80a7d234d678a238b9ed08ba64))
* **layout:** split .void by ownership so what ships is what the project wrote ([0982056](https://github.com/voidcorp-core/void-harness/commit/0982056da44a9e6575cabd0af4214bd253736609))
* **layout:** stop committing regenerated content, keep what a clone needs to work ([967aa3c](https://github.com/voidcorp-core/void-harness/commit/967aa3c7caa3f0e79ab923abf5a22eec1b4d1c8a))
* **release:** bound what consumers download instead of discovering it after publish ([5b87c37](https://github.com/voidcorp-core/void-harness/commit/5b87c37c24c55ab479aa16bd4c60ae5a37ae8d5d))
* **release:** bound what consumers download instead of discovering it after publish ([17f2622](https://github.com/voidcorp-core/void-harness/commit/17f2622198c280f6c1d2eb5f451f7375cff265b3))
* **session:** route the handoff residue to a checkpoint resume can read ([374ca67](https://github.com/voidcorp-core/void-harness/commit/374ca679971bacdaa05e9cc2e3fd13e954ad93d4))


### Bug Fixes

* **cli:** doctor stops sending operators after problems that are not theirs ([4b4ee9e](https://github.com/voidcorp-core/void-harness/commit/4b4ee9ef974564a8046172aff37453216ce215c1))
* **cli:** doctor stops sending operators after problems that are not theirs ([b82374c](https://github.com/voidcorp-core/void-harness/commit/b82374c7cdee5fcdbb958ebd868a4a4d8c4050ac))
* **cli:** stop counting an unfollowable edge as a path extraction missed ([15d6689](https://github.com/voidcorp-core/void-harness/commit/15d6689f870839e9ed2ceb9fae90172f4a958cb6))
* **cli:** stop counting an unfollowable edge as a path extraction missed ([c4430a4](https://github.com/voidcorp-core/void-harness/commit/c4430a49d54c5e52335a16c421e33010d41e1645))
* **decisions:** restore the accepted record, and put the forward pointer where it belongs ([19edb25](https://github.com/voidcorp-core/void-harness/commit/19edb2516786f32f15d58b0c96d0beac00c3687e))
* **graph:** a build is partial when its completeness is in doubt, not when one edge is unknowable ([fcb9c88](https://github.com/voidcorp-core/void-harness/commit/fcb9c88f3ccc1677d7e0d9722dbe24e249adf9a4))
* **graph:** alias the createRequire import so a bundling host can inline this package ([02d1c1f](https://github.com/voidcorp-core/void-harness/commit/02d1c1f7781385f56ce4500787d3fde7ef47f042))
* **graph:** dedupe related answers, and refuse a missing argument before the store opens ([d3a51dc](https://github.com/voidcorp-core/void-harness/commit/d3a51dc6089d578f33eca0c80756bf28d5a7ed74))
* **graph:** make partial mean something again, and stop a big file from switching off verification ([257ad91](https://github.com/voidcorp-core/void-harness/commit/257ad91a8b67e4b1d4e6494a4e4c967e1aaa7a4d))
* **layout:** carry the split through the conformance scripts and the fleet rollup ([37080ce](https://github.com/voidcorp-core/void-harness/commit/37080cee3a165602db960b448b0e9d5e829cf793))
* **layout:** ownership comes from the install receipt, never from the directory ([e678905](https://github.com/voidcorp-core/void-harness/commit/e6789059832f82d90f53713419f1eb5ca7f4958a))
* **scripts:** exempt the installer-managed block from the sister-doc parity gate ([0397c9b](https://github.com/voidcorp-core/void-harness/commit/0397c9bc5052ebddef5fc3ab45f03e5f92bb776f))
* **ui:** keep the projects link usable for the life of the process ([860124b](https://github.com/voidcorp-core/void-harness/commit/860124bae05d430310069c375d085fcb77f0a197))
* **ui:** refresh the view on return, and show the read time in local time ([8e89a82](https://github.com/voidcorp-core/void-harness/commit/8e89a8211fd74b1a36e35f8825963e133a4b46c5))


### Reverts

* **layout:** take the derived-content decision out of this PR ([455d5ec](https://github.com/voidcorp-core/void-harness/commit/455d5ec148bfc8186628b9fe45b5741bd4495264))

## [2.5.1](https://github.com/voidcorp-core/void-harness/compare/v2.5.0...v2.5.1) (2026-08-03)


### Bug Fixes

* **cli:** make --help explain instead of act, and stop calling unknown a failure ([ee030a7](https://github.com/voidcorp-core/void-harness/commit/ee030a7a975ab74889b18450ea1e12b7c85671f0))
* **cli:** make --help explain instead of act, stop calling unknown a failure, and drop the unproven claim ([933181c](https://github.com/voidcorp-core/void-harness/commit/933181cf38c00e682be125c48fa37ecf01c1b51a))
* **install:** delete the lint auto-repair, which could have switched a project's linter off ([452751e](https://github.com/voidcorp-core/void-harness/commit/452751e378ec6ec3083ac2c3df4877bb8b62e17c))
* **install:** read the project root, not the staging directory, when checking lint ([519d280](https://github.com/voidcorp-core/void-harness/commit/519d2803b5b7566cfd0c0600f73334dbb1837052))
* **install:** read the project root, not the staging directory, when checking lint ([86f7606](https://github.com/voidcorp-core/void-harness/commit/86f760645b5d7c2123853d371ec5175cd407186d))
* **project-graph:** check the root identity instead of watching for it ([5a76710](https://github.com/voidcorp-core/void-harness/commit/5a7671040d82ecbe0c190918ad5e33c6a97924a7))
* **test:** wait for the watch event instead of for fifty milliseconds ([4787ebe](https://github.com/voidcorp-core/void-harness/commit/4787ebeba32fbc47e454f10250be45df8f310484))
* **test:** wait for the watch event instead of for fifty milliseconds ([a110b13](https://github.com/voidcorp-core/void-harness/commit/a110b13f3261b12f1a88d2d1f21a23aeed296ee2))
* **test:** wait for the watch event instead of for fifty milliseconds ([ee09218](https://github.com/voidcorp-core/void-harness/commit/ee09218a23f61dc94b24c803564c0647af3eb945))

## [2.5.0](https://github.com/voidcorp-core/void-harness/compare/v2.4.0...v2.5.0) (2026-08-03)


### Features

* **autopilot:** delegate workers to ticket-runner because ticket quality must have one owner ([47b2a48](https://github.com/voidcorp-core/void-harness/commit/47b2a481f8a6062867edc6047962d3a61fe72d67))
* **autopilot:** publish one reconciliation PR because CI cost belongs at the cluster boundary ([9697e5a](https://github.com/voidcorp-core/void-harness/commit/9697e5a73327976efe479b50af719ed4b6ade68e))
* **autopilot:** range B — worker contract and worktree fan-out ([9515bfc](https://github.com/voidcorp-core/void-harness/commit/9515bfc558c4a2d0f1cdb0c0cf6128047cc811b9))
* **autopilot:** reconcile exact ticket ranges because one PR must retain per-ticket provenance ([e5f76f4](https://github.com/voidcorp-core/void-harness/commit/e5f76f4713f339d5e75cabc64c3be127ad8fe2ee))
* **autopilot:** reconcile remote and tracker state because session resume must be idempotent ([e2c03e8](https://github.com/voidcorp-core/void-harness/commit/e2c03e8ddd5201cf19928aad55be5d854516a83d))
* **autopilot:** run one bounded ticket cluster because parallelism must stay isolated ([5d86841](https://github.com/voidcorp-core/void-harness/commit/5d868413b48b4ff53189435b64f9da385c67ceaf))
* **autopilot:** seal local verification because publication must start from a green integration SHA ([3ea6f4b](https://github.com/voidcorp-core/void-harness/commit/3ea6f4b67433613c91fecbe85d4da3d9a905841c))
* **docs:** generate the cheat sheet from the catalogue, and link it ([695fa02](https://github.com/voidcorp-core/void-harness/commit/695fa0277ccd67b193911ab8ef6e0dfecefe3ad8))
* **dx:** add one verify command ([bdacc79](https://github.com/voidcorp-core/void-harness/commit/bdacc79d648bbc1cc0c3f1b0a9557c0e6c86b9ef))
* **dx:** add one verify command because knowing the gate list should not be the gate ([640ab03](https://github.com/voidcorp-core/void-harness/commit/640ab03797c25b21cbee2a8abb81a00f852bebd4))
* **project-graph:** analyse each project with its own compiler, and record which one ([3090b93](https://github.com/voidcorp-core/void-harness/commit/3090b935d5032f6a5d417c5353a4e586cb121014))
* **security:** add the security command, and let each scanner declare what its exit codes mean ([16ab47a](https://github.com/voidcorp-core/void-harness/commit/16ab47abc1cc0ef0a2f2332747abeee3481486a0))
* **security:** baseline sécurité locale et refus par défaut de toute cible non autorisée ([acc315b](https://github.com/voidcorp-core/void-harness/commit/acc315bf23ea5dd657f563d1eda28388f89ed776))
* **security:** decide severity from the class because a scanner is untrusted input ([1b191cb](https://github.com/voidcorp-core/void-harness/commit/1b191cbf74bcf075918edcb532d5dd6a65f94be7))
* **security:** describe scanners in a manifest that cannot execute or grade anything ([41571d7](https://github.com/voidcorp-core/void-harness/commit/41571d74840c7c66fb9114f115c39aaae7e2a9d1))
* **security:** ship the periodic CI template, an OWASP fixture that proves detection, and route the audit skill to the command ([4d0e1ce](https://github.com/voidcorp-core/void-harness/commit/4d0e1cec5bd92428e5761eb5c30018e3639d5b1e))
* **security:** turn scanner output into findings the engine judges, and never quote a secret back ([14a4e8a](https://github.com/voidcorp-core/void-harness/commit/14a4e8a590a0ae08717522b5b84f12ba9eab4491))
* **skills:** add session-handoff because the expensive half of a session is what you ruled out ([3d6011c](https://github.com/voidcorp-core/void-harness/commit/3d6011ca4688a31f1ac92d31fc65cd1c138fc0aa))


### Bug Fixes

* **cli:** bundle picomatch because the published tarball installs offline ([5e15329](https://github.com/voidcorp-core/void-harness/commit/5e1532918a6aba8f7d9f4bcd19dfcb6e0e051ebf))
* **graph:** stop counting sourced hook libraries as hooks ([0066107](https://github.com/voidcorp-core/void-harness/commit/006610732ae416fa083004828178135003edc0a4))
* **hooks:** judge cross-package imports against declared dependencies, not an invented topology ([005ae70](https://github.com/voidcorp-core/void-harness/commit/005ae702b570ec53817e856d7f41f42a2c304c70))
* **hooks:** let the project's own linter config decide, instead of overruling it ([c162970](https://github.com/voidcorp-core/void-harness/commit/c162970a60d28311a55c66721ae38986725545ee))
* **install:** keep the harness out of the consumer's lint ([8a62ef0](https://github.com/voidcorp-core/void-harness/commit/8a62ef0b9e774a610893b6dd48ed6879f19f25ca))
* **install:** keep the harness out of the consumer's lint, because it put the file there ([3c2a8fb](https://github.com/voidcorp-core/void-harness/commit/3c2a8fb0b5bbb673ad19be8353c48b3fd79558c5))
* **lint:** correct two diagnostics the truncated gate was hiding ([e47e8aa](https://github.com/voidcorp-core/void-harness/commit/e47e8aa1e4fb01f172de5d45578863f178501db9))
* **lint:** report every diagnostic because a truncated gate is a blind gate ([9e73026](https://github.com/voidcorp-core/void-harness/commit/9e73026780cee878651cddfed7edb1a0f67df7ca))
* **readme:** count from the graph model ([4e4c779](https://github.com/voidcorp-core/void-harness/commit/4e4c77981219d776b9ec62380bcdfe9569eca28d))
* **readme:** count from the graph model, because two answers to one question is the bug ([06b38ee](https://github.com/voidcorp-core/void-harness/commit/06b38eeef01d24243b77f5703cb32927797a07f9))

## [2.4.0](https://github.com/voidcorp-core/void-harness/compare/v2.3.0...v2.4.0) (2026-07-29)


### Features

* **autopilot:** add the isolated planning core because cutover needs a tested destination ([91cec27](https://github.com/voidcorp-core/void-harness/commit/91cec270727ac66a267f28fb365a4cb87b451ffc))
* **autopilot:** load the active program contract because sessions need durable authority ([5790fdc](https://github.com/voidcorp-core/void-harness/commit/5790fdc0ea0bc37bb393dc925e8e7a611ecd4f81))
* **autopilot:** persist one versioned run state because sessions need idempotent recovery ([7157252](https://github.com/voidcorp-core/void-harness/commit/7157252007d9e405b4372350fc28eff0e44b699c))
* **autopilot:** plan a reobserved lease because workers need converged ownership ([c987ed0](https://github.com/voidcorp-core/void-harness/commit/c987ed021b7048ab585a5f1736c00964638803b7))
* **autopilot:** range A — planner, active program contract, lease and run state ([a60ee28](https://github.com/voidcorp-core/void-harness/commit/a60ee28f9827fdbd787cd20066908f29abbbb36d))


### Bug Fixes

* **release:** approve by head sha because the release branch outlives its runs ([addb271](https://github.com/voidcorp-core/void-harness/commit/addb271ef0fe995a3e17ae84287e5e7a9dcbdd9e))
* **release:** approve by head sha, not by branch ([05361bf](https://github.com/voidcorp-core/void-harness/commit/05361bf8bb5184c3a1ae191d08400e76954dd2bc))
* **release:** approve the waiting PR checks ([a0281ec](https://github.com/voidcorp-core/void-harness/commit/a0281eccd5cf1907ca4b776af04eda66d256e6cd))
* **release:** approve the waiting PR checks because dispatched runs do not unblock a merge ([c1fc393](https://github.com/voidcorp-core/void-harness/commit/c1fc393cc4eee8c9d39d1b98f3747c1c869c2bf5))
* **release:** poll for the release PR and its runs ([201e511](https://github.com/voidcorp-core/void-harness/commit/201e5119b17d37fd142b45bf99244fd7c683b788))
* **release:** poll for the release PR and its runs because both appear after the signal that announces them ([714a999](https://github.com/voidcorp-core/void-harness/commit/714a999f7eed2f3dd5ab7271afda5b2b275b2719))

## [2.3.0](https://github.com/voidcorp-core/void-harness/compare/v2.2.0...v2.3.0) (2026-07-29)


### Features

* add native project topology and dynamic specialist routing (DEV-436, DEV-440) ([e1cd55d](https://github.com/voidcorp-core/void-harness/commit/e1cd55d1861807bab83bcc9c5e3a3f5cff429ab6))
* **graph:** add native project topology extraction ([ea32cfa](https://github.com/voidcorp-core/void-harness/commit/ea32cfab4b8b8e8f8977829dee7a761fcd4129c0))
* **specialists:** complete dynamic team routing ([7078014](https://github.com/voidcorp-core/void-harness/commit/707801492b5499ca89b35fa03129ec1b0409d209))


### Bug Fixes

* **benchmark:** honour the stability signal because an advisory journal is not an invariant ([031a8b4](https://github.com/voidcorp-core/void-harness/commit/031a8b4e77ef39dc292f24a85115ccc262dad0fa))
* **ci:** build before the ProjectGraph benchmark because it resolves cross-package dist exports ([26401d3](https://github.com/voidcorp-core/void-harness/commit/26401d3017acca1de453257465a381d9c2013272))
* **project-graph:** canonicalise the cache root key with the native realpath because casing must match the root port ([ad2ea29](https://github.com/voidcorp-core/void-harness/commit/ad2ea29ea37548777b555279b5b6776f873c1679))
* **project-graph:** launch pnpm through the shared helper because Windows rejects cmd shims ([c3e3e5d](https://github.com/voidcorp-core/void-harness/commit/c3e3e5d12170a16956444ff2127d9609e80149cf))
* **release:** name the repository for the CI dispatch ([c92da52](https://github.com/voidcorp-core/void-harness/commit/c92da52973cebd5e038d6f7879821da5a039b069))
* **release:** name the repository for the CI dispatch because gh has no worktree to infer it from ([d6f5c0b](https://github.com/voidcorp-core/void-harness/commit/d6f5c0b6c9a1de09c3924bd35b68af471375cc1a))
* **test:** mirror the root test timeout because a filtered run must not judge differently ([4dffb7b](https://github.com/voidcorp-core/void-harness/commit/4dffb7b703b963e3d7b2c961adf8a6b4993e785f))

## [2.2.0](https://github.com/voidcorp-core/void-harness/compare/v2.1.0...v2.2.0) (2026-07-28)


### Features

* **cli:** render the active-program bootstrap because consumers lose the thread between sessions ([6076da4](https://github.com/voidcorp-core/void-harness/commit/6076da4ca6a5dae31dd33c183358ce05d3154786))
* **cli:** report the published version in status and doctor ([f68ce97](https://github.com/voidcorp-core/void-harness/commit/f68ce9708e9f654b4b4a6b0dd1d8f4ab00812f10))
* **freshness:** compare the installed harness against the published version ([2d89911](https://github.com/voidcorp-core/void-harness/commit/2d89911e598ffaeaf0fc5ba2f885d70dbc205cdc))
* **hook:** tell a session once when its harness is outdated ([6ab45b1](https://github.com/voidcorp-core/void-harness/commit/6ab45b11fd491c08c2797898a4dba4a6df7e4b59))
* recover the active program across sessions ([faf4cf6](https://github.com/voidcorp-core/void-harness/commit/faf4cf64a6eec129e952fe55b896e2f108a8e3d3))
* **skills:** make the tracker lifecycle part of execution because a PR is not completion ([9c6e909](https://github.com/voidcorp-core/void-harness/commit/9c6e909c5cb11a6a3d6824e522a5fc79469163b0))
* tell a project when its harness is behind the published version ([fb92025](https://github.com/voidcorp-core/void-harness/commit/fb92025f3fdc465d735379b98f26be2f97d2358f))

## [2.1.0](https://github.com/voidcorp-core/void-harness/compare/v2.0.2...v2.1.0) (2026-07-28)


### Features

* add UI quality, stack profiles, and Graph v3 ([afa4275](https://github.com/voidcorp-core/void-harness/commit/afa4275925eaa92f7601069ec3c2c060d3125d35))
* build v3 Foundation and prove installed hooks ([bf2c4f0](https://github.com/voidcorp-core/void-harness/commit/bf2c4f0bc65fd324046b3c49e930a70156824806))
* **config:** emit argv commands because portable execution must avoid shell parsing ([4ffba37](https://github.com/voidcorp-core/void-harness/commit/4ffba37176c6d1ab0d6e616c77c527f7450bae28))
* **conformance:** execute installed hooks across runtimes ([5336596](https://github.com/voidcorp-core/void-harness/commit/5336596955caec5fc590eee6f7911a293fc55ab1))
* **decisions:** isolate ADR writes because parallel agents need conflict-free ownership ([a39d8ad](https://github.com/voidcorp-core/void-harness/commit/a39d8adab4828d8cd36b7e1ab8cd01079f202266))
* **enforce:** port critical guards to Node because the safety floor must be cross-platform ([7cc4071](https://github.com/voidcorp-core/void-harness/commit/7cc4071ab0956159745099b0544bd9ffb583e0b9))
* **events:** add canonical mission replay because live truth must expose gaps ([74b2e6c](https://github.com/voidcorp-core/void-harness/commit/74b2e6c96ecdd8d59571ddec12aadcf23d601916))
* **events:** record hook outcomes because lifecycle degradation must be observable ([49811da](https://github.com/voidcorp-core/void-harness/commit/49811daea085d47e5a4f7b52c9c2312b86cccf03))
* **evidence:** bind verdicts to fresh proofs because stale success must stay red ([f079a6e](https://github.com/voidcorp-core/void-harness/commit/f079a6ec7644ef12236526211df139028180e9de))
* **graph:** add a validated v3 envelope because compatibility must preserve provenance ([8c3f8da](https://github.com/voidcorp-core/void-harness/commit/8c3f8da7ff94472656ca62cfc133b2a88b864e52))
* **hooks:** make size review provider-agnostic because advisory evidence must travel with Git ([6909c40](https://github.com/voidcorp-core/void-harness/commit/6909c405dfc24f7dc460939d6f8aefd513d4e276))
* **hooks:** port scoped quality rules because agnostic enforcement must stay relevant ([fc4f819](https://github.com/voidcorp-core/void-harness/commit/fc4f819b0494f5b38107ff0c629c3fdf6bb59425))
* **init:** add ownership receipts because updates and removal must be reversible ([2aa2223](https://github.com/voidcorp-core/void-harness/commit/2aa2223648113d127356b7d532e7e44e2c2b5cc5))
* **init:** materialize local runtime assets because account-free install is the primary path ([650f983](https://github.com/voidcorp-core/void-harness/commit/650f983502f594ba46353aa75e04b57daef6aadd))
* **lifecycle:** add pure portable plans because adapters need deterministic policy ([4579b6e](https://github.com/voidcorp-core/void-harness/commit/4579b6ec6cedc6c9ed3ea6ac59de905a11208721))
* **lifecycle:** replace shell policy with bounded Node adapters because hooks must degrade visibly ([e7f610a](https://github.com/voidcorp-core/void-harness/commit/e7f610ae5497f4e747a05038824d071ecd4a0816))
* **mission-engine:** gate team reviews because command proof cannot replace specialists ([ef0b6a6](https://github.com/voidcorp-core/void-harness/commit/ef0b6a6a3a9a53d5c66aedc0f7f563d01399c149))
* **mission:** add risk modes and idempotent recovery ([73ff56a](https://github.com/voidcorp-core/void-harness/commit/73ff56a3e304f2ecf12cb928f3f0fc776fa0de32))
* **mission:** add risk modes and idempotent recovery because quality must survive interruption ([753cb79](https://github.com/voidcorp-core/void-harness/commit/753cb7919629b8547ba24fc02f464f71c49c46cc))
* **mission:** compile policies because every pass needs proof ([4870cf5](https://github.com/voidcorp-core/void-harness/commit/4870cf547650e3dac300809342776d064f4a058b))
* **packs:** reconcile local assets because lifecycle commands must honor receipts ([079420e](https://github.com/voidcorp-core/void-harness/commit/079420e6fca657667340b8ecc8c6179e5b814b5d))
* **profiles:** route fresh stack guidance because monorepos need local expertise ([4823cc9](https://github.com/voidcorp-core/void-harness/commit/4823cc9d0080ebc1d31a9f7d64912c1a6ac79a25))
* **runtime:** install one Node asset because native hooks must be dependency-free ([fc6f018](https://github.com/voidcorp-core/void-harness/commit/fc6f01868ec8b4e5c9d608f542c10d99fc7a3e3f))
* **self-host:** compile local runtime assets because the harness must consume itself ([f281525](https://github.com/voidcorp-core/void-harness/commit/f281525e85348f6075f647b62fbac4fc35da81aa))
* **specialists:** compile native architecture, security, and QA agents ([#160](https://github.com/voidcorp-core/void-harness/issues/160)) ([b6bc309](https://github.com/voidcorp-core/void-harness/commit/b6bc3097462087582c2ec82a29af3839f7c9ffae))
* **ticket-runner:** orchestrate the native MVP team ([6de2865](https://github.com/voidcorp-core/void-harness/commit/6de2865ab86646c6a08bc71b7f44e6ecf27d8323))
* **ticket-runner:** scope native reviews because one writer needs independent proof ([2ef4bac](https://github.com/voidcorp-core/void-harness/commit/2ef4bac8d4bdb53e7ca41f6159ad74515c2d41db))
* **ui:** gate approval on fresh evidence because builders cannot self-certify ([a6c0b51](https://github.com/voidcorp-core/void-harness/commit/a6c0b51be11d0b6191741fa799c49b019bacb89a))


### Bug Fixes

* **build:** order clean checkout CLI dependencies ([2ad7d52](https://github.com/voidcorp-core/void-harness/commit/2ad7d5200553a7d361fd0e66f74e1b491bd755b8))
* **ci:** fetch ADR comparison base because immutability must fail honestly ([e1758f2](https://github.com/voidcorp-core/void-harness/commit/e1758f2ca7f644cde90620e71c79b4299dabc6b7))
* **conformance:** launch package managers through Node because Windows rejects cmd shims ([256933d](https://github.com/voidcorp-core/void-harness/commit/256933deab3100ccdc9890491baf15320cd598ed))
* **doctor:** execute runtime postconditions because installed must not mean working ([3852ae0](https://github.com/voidcorp-core/void-harness/commit/3852ae0c71d24e056dddcd576024e2d55dd5811d))
* **enforce:** exempt certified artifacts because bounded scans must fail usefully ([dd8cc73](https://github.com/voidcorp-core/void-harness/commit/dd8cc73711099ee97a5fafd4a83c3cb1e50c9f81))
* **hooks:** preserve executable adapters because compatibility must remain live ([234af19](https://github.com/voidcorp-core/void-harness/commit/234af19e32071dec20c292c3cad48fcade93fbf9))
* **hooks:** preserve lifecycle edge contracts because portability must not hide failures ([3ec8700](https://github.com/voidcorp-core/void-harness/commit/3ec8700de3bb7e6ea26cbfe6471ef1d0971a4185))
* **hooks:** reject malformed refs without control regexes because the lint gate is part of portability ([b726059](https://github.com/voidcorp-core/void-harness/commit/b726059f87cd07f1bab68b776d50d5ab728e430e))
* **release:** drop obsolete marketplace dispatch because releases are self-hosted (DEV-519) ([c359a06](https://github.com/voidcorp-core/void-harness/commit/c359a06873913bce855670772b89743350856f76))
* **release:** drop obsolete void-plugins dispatch (DEV-519) ([673ea6a](https://github.com/voidcorp-core/void-harness/commit/673ea6ae21617b07eb8e7008c504a0d18d85734b))
* **self-host:** close source and credential gaps because dogfood must be trustworthy ([bce4130](https://github.com/voidcorp-core/void-harness/commit/bce41305c5e5e1822823f5333f650b85a1728738))
* **skills:** parse CRLF frontmatter because Windows installs must retain the skill surface ([5e70780](https://github.com/voidcorp-core/void-harness/commit/5e70780ff39a240f8f689364c1f451a668ae2738))
* **studio:** project scrubber status through pure state ([126f83d](https://github.com/voidcorp-core/void-harness/commit/126f83d43eb8e44f89393b6bc9846606503625ee))
* **tdd:** ignore non-executable assets because UI proof is not a sibling file ([2b8af76](https://github.com/voidcorp-core/void-harness/commit/2b8af76bd5f9e8dd5118096b197c6eb2a9e1642a))

## [2.0.2](https://github.com/voidcorp-core/void-harness/compare/v2.0.1...v2.0.2) (2026-07-24)


### Bug Fixes

* **release:** declare provenance explicitly, and stop the README claiming it ([#154](https://github.com/voidcorp-core/void-harness/issues/154)) ([00c18ca](https://github.com/voidcorp-core/void-harness/commit/00c18ca7017dd0a88584a5ff97f7f7c6ce1144ed))

## [2.0.1](https://github.com/voidcorp-core/void-harness/compare/v2.0.0...v2.0.1) (2026-07-24)


### Bug Fixes

* **ci:** build before typecheck in the publish gate ([#150](https://github.com/voidcorp-core/void-harness/issues/150)) ([3772698](https://github.com/voidcorp-core/void-harness/commit/377269847e8b476759f7b6324f82acd5a043be2d))
* **ci:** drop setup-node's registry-url, which silently disabled OIDC publishing ([#153](https://github.com/voidcorp-core/void-harness/issues/153)) ([4615574](https://github.com/voidcorp-core/void-harness/commit/4615574401f1c583861344a128da7ba7a4e7c1c2))

## [2.0.0](https://github.com/voidcorp-core/void-harness/compare/v1.2.0...v2.0.0) (2026-07-24)


### ⚠ BREAKING CHANGES

* **init:** transactional install — preflight before writing, rollback on failure ([#142](https://github.com/voidcorp-core/void-harness/issues/142))
* **cli:** the CLI npm package is now `voidharness`, not `@voidfactory/harness`. Requires a one-time npm Trusted Publisher re-bootstrap under the new name (see docs/RELEASING.md "First publish").

### Features

* **cli:** rename npm package @voidfactory/harness -&gt; voidharness, add `vh` bin alias ([#140](https://github.com/voidcorp-core/void-harness/issues/140)) ([ffa1f5d](https://github.com/voidcorp-core/void-harness/commit/ffa1f5da89c533afd46a566a807b644472969834))
* **codex:** mirror the full Claude enforcement surface and compile the agents ([58013d1](https://github.com/voidcorp-core/void-harness/commit/58013d1c524a8f7e1ab9d267d78c8ec490dc217a))
* **codex:** stage skills into .agents/skills so Codex can discover them ([#125](https://github.com/voidcorp-core/void-harness/issues/125)) ([#131](https://github.com/voidcorp-core/void-harness/issues/131)) ([d6b6938](https://github.com/voidcorp-core/void-harness/commit/d6b6938af2633b5f7ae4eb2f316d783849cbda7c))
* **marketplace:** self-host the plugin catalog in this repo ([#133](https://github.com/voidcorp-core/void-harness/issues/133)) ([366dc3f](https://github.com/voidcorp-core/void-harness/commit/366dc3f3ab18cda863a3d22f8215aeb1047836f2))
* **status:** enforcement scored as coverage, not the strongest single tier ([#126](https://github.com/voidcorp-core/void-harness/issues/126)) ([#135](https://github.com/voidcorp-core/void-harness/issues/135)) ([ee2cba2](https://github.com/voidcorp-core/void-harness/commit/ee2cba20647eb781f08e44567308f80fd0f1e133))
* **status:** install-state filters by activated packs, not the whole catalog ([#126](https://github.com/voidcorp-core/void-harness/issues/126)) ([#134](https://github.com/voidcorp-core/void-harness/issues/134)) ([171a779](https://github.com/voidcorp-core/void-harness/commit/171a77996ba3c566bfb2542418e7562dd0c5a2f3))


### Bug Fixes

* **init:** --pack installs the pack's skills instead of reporting a fake success ([ba501e2](https://github.com/voidcorp-core/void-harness/commit/ba501e2b57471d01d71b35d3d5e69a8c46745126))
* **init:** transactional install — preflight before writing, rollback on failure ([#142](https://github.com/voidcorp-core/void-harness/issues/142)) ([ac9e3cd](https://github.com/voidcorp-core/void-harness/commit/ac9e3cd12849b71dfdc857626ada7b0528d0a171))
* **skills:** valid-YAML frontmatter for the 7 colon-carrying descriptions ([#130](https://github.com/voidcorp-core/void-harness/issues/130)) ([#136](https://github.com/voidcorp-core/void-harness/issues/136)) ([9bf17f7](https://github.com/voidcorp-core/void-harness/commit/9bf17f7e5a488b49691290defddaf90e408d940c))
* **status:** activation is pending when usage is unobservable (Codex), not 0 ([#143](https://github.com/voidcorp-core/void-harness/issues/143)) ([feca777](https://github.com/voidcorp-core/void-harness/commit/feca7778a021c626c76f8932cbf0f8c05e4008b2))
* **status:** call it "structure score" until there's behavioral evidence ([#6](https://github.com/voidcorp-core/void-harness/issues/6)) ([#146](https://github.com/voidcorp-core/void-harness/issues/146)) ([479420a](https://github.com/voidcorp-core/void-harness/commit/479420a43b20e452658c3fcf8cab2979568d2cce))

## [1.2.0](https://github.com/voidcorp-core/void-harness/compare/v1.1.0...v1.2.0) (2026-07-22)


### Features

* **cli:** give `help` the void identity + a pnpm-dlx hint ([71ee231](https://github.com/voidcorp-core/void-harness/commit/71ee231879481d5433b6719ed9111f6d92e1a39f))
* **cli:** help screen gets the void identity + pnpm-dlx hint ([b26147d](https://github.com/voidcorp-core/void-harness/commit/b26147d8ecbce83423c9413e37318e0f0fd19efc))


### Bug Fixes

* **cli:** chmod +x staged Codex hooks (pack strips the exec bit) ([0bcba92](https://github.com/voidcorp-core/void-harness/commit/0bcba92653e4867e894c98ebf827a8cf19b6ad27))
* **cli:** chmod +x the staged Codex hooks — pack strips the exec bit ([54d88f3](https://github.com/voidcorp-core/void-harness/commit/54d88f37402ab72233cce06d524a411d8545ff2e))
* **release:** bump repo to pnpm 10 so OIDC trusted publishing works; add manual re-publish ([638f66f](https://github.com/voidcorp-core/void-harness/commit/638f66f7a6d0eac967db82fb51993d7a4657bee2))
* **release:** pnpm 10 for OIDC publishing + manual re-publish ([22327a0](https://github.com/voidcorp-core/void-harness/commit/22327a08bc0e107da01118951ddbabab13832052))

## [1.1.0](https://github.com/voidcorp-core/void-harness/compare/v1.0.0...v1.1.0) (2026-07-22)


### Features

* **cli:** a "void in the shell" visual identity + README refresh for 1.0.0 ([23c78c2](https://github.com/voidcorp-core/void-harness/commit/23c78c2e52b7c2dfc8eaa08b58705379dbacaa3e))
* **cli:** void-in-the-shell visual identity + README refresh for 1.0.0 ([11aa3e7](https://github.com/voidcorp-core/void-harness/commit/11aa3e78bef80c37c33e53f3c11eb596d5484ed3))

## [1.0.0](https://github.com/voidcorp-core/void-harness/compare/v0.17.0...v1.0.0) (2026-07-22)

First public release. Declares the CLI's public surface stable; from here,
Conventional Commits map to standard SemVer (breaking → major).

### Features

* **cli:** multi-runtime harness via a runtime-adapter seam — `init`/`runtime add`/`doctor` iterate runtime adapters (Claude Code + Codex), each owning its wiring and doctrine doc; add a runtime a-posteriori without friction ([#111](https://github.com/voidcorp-core/void-harness/pull/111))
* **cli:** `graph` reporting works standalone by reusing the shipped model.json ([#114](https://github.com/voidcorp-core/void-harness/pull/114))

### Continuous Integration

* **release:** tokenless, provenance-signed npm publish via Trusted Publishing (OIDC), gated on the release-PR merge ([#113](https://github.com/voidcorp-core/void-harness/pull/113), [#116](https://github.com/voidcorp-core/void-harness/pull/116))

## [0.17.0](https://github.com/voidcorp-core/void-harness/compare/v0.16.0...v0.17.0) (2026-07-21)


### Features

* **hooks:** trim oversized Bash/MCP tool output (token frugality) ([#104](https://github.com/voidcorp-core/void-harness/issues/104)) ([6aab377](https://github.com/voidcorp-core/void-harness/commit/6aab37789f250935bd5ced762e881b403283c9cc))

## [0.16.0](https://github.com/voidcorp-core/void-harness/compare/v0.15.0...v0.16.0) (2026-07-10)


### Features

* **audit:** cross-project telemetry rollup + opt-in issue push ([#72](https://github.com/voidcorp-core/void-harness/issues/72)) ([89d83c0](https://github.com/voidcorp-core/void-harness/commit/89d83c05dd725fce5c58da9c28ef910dec52fa93))
* **backlog-autopilot:** per-worker model tier driven by ticket stakes (DEV-404) ([d97407d](https://github.com/voidcorp-core/void-harness/commit/d97407ddfe7083fa96e1de2e798a99049aeb3fe8))
* **backlog-autopilot:** per-worker model tier driven by ticket stakes (DEV-404) ([f070f3a](https://github.com/voidcorp-core/void-harness/commit/f070f3a8e2f238cd8d37a4f94556a8b4310e9302))
* **backlog-autopilot:** shared-append conflict protocol — owned by integration (DEV-402) ([063c59a](https://github.com/voidcorp-core/void-harness/commit/063c59affc9fe0109fb4847c7cdd34f6fc3494b9))
* **backlog-autopilot:** shared-append conflict protocol — owned by integration, not workers (DEV-402) ([825968c](https://github.com/voidcorp-core/void-harness/commit/825968cdd63c2ca66f087c6e46f031e92c7a8307))
* **brainstorming:** sharpen the demand pre-emption and the per-turn assignment (DEV-386) ([56caf99](https://github.com/voidcorp-core/void-harness/commit/56caf9998f2b38ce12c8658a90a4248b19be2132))
* **cli:** doctor validates config by schema + checks hook/pack health ([#68](https://github.com/voidcorp-core/void-harness/issues/68)) ([7a06636](https://github.com/voidcorp-core/void-harness/commit/7a06636f1257f21ea54bf3e44b4c0d927c1c8f91))
* **cli:** init fails loud on missing prerequisites, never pins a stale version ([#67](https://github.com/voidcorp-core/void-harness/issues/67)) ([61c7b06](https://github.com/voidcorp-core/void-harness/commit/61c7b06dd05fd7b0245b16f6dd589f0b3b644c06))
* **contract:** forge-&gt;harness spec artifact contract on the core-hub model ([#76](https://github.com/voidcorp-core/void-harness/issues/76)) ([6eaf759](https://github.com/voidcorp-core/void-harness/commit/6eaf7596f0ee75e4a1975169f83d78b7b64a9ac1))
* **devex-audit:** vendor the live DX audit as a dedicated audit-ceiling skill (DEV-398) ([7591bc4](https://github.com/voidcorp-core/void-harness/commit/7591bc4471249c9efe1a121ae3353937efde4ef8))
* **devex-audit:** vendor the live DX audit as a dedicated audit-ceiling skill (DEV-398) ([79e9259](https://github.com/voidcorp-core/void-harness/commit/79e9259c7e0a483c7c0a1f91d4f31220dce30e7e))
* **enforce:** replay the floor server-side via a shared-logic GitHub Action (DEV-393) ([8d9ca7b](https://github.com/voidcorp-core/void-harness/commit/8d9ca7bde4dcf1bb3b15e53f0e248ae46f4773e0))
* **enforce:** server-side floor via a shared-logic GitHub Action (DEV-393) ([ccc2226](https://github.com/voidcorp-core/void-harness/commit/ccc22263aa848eb4cdc00582bbb476eb6597cef5))
* **eval-harness:** behavioral skill evals — measure prose effect, not form (DEV-394) ([7b13aae](https://github.com/voidcorp-core/void-harness/commit/7b13aae48c0cbcc936c024c0da81e5c5fd275634))
* **eval-harness:** behavioral skill evals — measure the prose's effect, not its form (DEV-394) ([c3f37f5](https://github.com/voidcorp-core/void-harness/commit/c3f37f51b9a6f21b16f97ce53154a8ad576e5124))
* **eval-harness:** LLM judge (injected port, last resort) + blind head-to-head (DEV-397) ([4bc1896](https://github.com/voidcorp-core/void-harness/commit/4bc1896e41ff2f3f8084c3d059cd429d6e16af4b))
* **eval-harness:** LLM judge (injected port, last resort) + blind head-to-head (DEV-397) ([2c8401a](https://github.com/voidcorp-core/void-harness/commit/2c8401aee94d44ac2035479c6ddb62cd94ae42d0))
* **hooks:** secret-in-content (blocking) + stop-typecheck (advisory) ([#77](https://github.com/voidcorp-core/void-harness/issues/77)) ([86e178a](https://github.com/voidcorp-core/void-harness/commit/86e178a13f155e2b7f12645a329907c1a287bad1))
* **make-pdf:** rebuild gstack make-pdf on marked + puppeteer-core, page numbers (DEV-391) ([d32999b](https://github.com/voidcorp-core/void-harness/commit/d32999b9eb8b51558345fa3cc76bf8c807986fe1))
* **make-pdf:** rebuild on marked + puppeteer-core, page numbers (DEV-391) ([a9208be](https://github.com/voidcorp-core/void-harness/commit/a9208bee829a0b6570fc0875060f8b5ebf31fcd1))
* **qa:** vendor live browser QA re-pointed onto the claude-in-chrome MCP (DEV-390) ([2268f27](https://github.com/voidcorp-core/void-harness/commit/2268f27f5b37d5dab0b072b1750061a8de4a1bbb))
* **qa:** vendor live browser QA re-pointed onto the claude-in-chrome MCP (DEV-390) ([28c1090](https://github.com/voidcorp-core/void-harness/commit/28c109078a29736883e6d6a0508dc94d56fa0ea0))
* **skills:** fold ship/spec/investigate deltas into existing skills (DEV-388) ([d35805e](https://github.com/voidcorp-core/void-harness/commit/d35805e3f9afb28f3cc8f943b576fa8d2944f875))
* **skills:** fold ship/spec/investigate deltas into existing skills (DEV-388) ([46a94b7](https://github.com/voidcorp-core/void-harness/commit/46a94b756aa12a8a008925fac99d6d4530f21429))
* **skills:** split design craft into frontend-design (build) + new ui-review (audit); internalise impeccable (DEV-389) ([7b593b9](https://github.com/voidcorp-core/void-harness/commit/7b593b9f6aeed9b396535deb3eb2718903d72759))
* **skills:** split design craft into frontend-design (build) + ui-review (audit); internalise impeccable (DEV-389) ([b42a20c](https://github.com/voidcorp-core/void-harness/commit/b42a20c13b0ff7a018cb27b71e60cd3f635d0580))
* **skills:** vendor gstack /cso as a dedicated security-audit skill (DEV-387) ([3f8bb0f](https://github.com/voidcorp-core/void-harness/commit/3f8bb0f98217f9c18a5609cccceb7d2bd29a9e15))
* **skills:** vendor gstack /cso as a dedicated security-audit skill (DEV-387) ([14db394](https://github.com/voidcorp-core/void-harness/commit/14db3949f764753136c96aa58ef39274803eb190))
* **skills:** vendor gstack /office-hours into brainstorming (DEV-386) ([1bc18a6](https://github.com/voidcorp-core/void-harness/commit/1bc18a69ab6397c2cd0c64dfd51e03165405083c))
* **skills:** vendor gstack /office-hours into brainstorming as an idea pressure-test mode (DEV-386) ([beab071](https://github.com/voidcorp-core/void-harness/commit/beab071515a81c437c98324c65697e4ce107e4b1))
* **skills:** vendor gstack /retro as harness:retrospective (DEV-396) ([3f7750b](https://github.com/voidcorp-core/void-harness/commit/3f7750b32c6ea877ca731b57a4696b330a1bffba))
* **skills:** vendor gstack /retro as harness:retrospective, gamification dropped (DEV-396) ([481d846](https://github.com/voidcorp-core/void-harness/commit/481d8467cf657705af37f92a14a89a70354b9293))
* **skills:** vendor the 4 gstack plan-reviews + autoplan as one plan-review skill (DEV-385) ([a373ef1](https://github.com/voidcorp-core/void-harness/commit/a373ef1f751a1d56b0d3085a2341fd85f050d3de))
* **skills:** vendor the 4 gstack plan-reviews + autoplan as one plan-review skill (DEV-385) ([60f864b](https://github.com/voidcorp-core/void-harness/commit/60f864b6c798237362020b539e2626e969ec0791))
* **telemetry:** capture outcomes to turn cost telemetry into a cost/value ledger ([#71](https://github.com/voidcorp-core/void-harness/issues/71)) ([0647116](https://github.com/voidcorp-core/void-harness/commit/0647116785632fe692313c377c6fe21b63992790))
* **ticket-runner:** apply migrations to dev/local before tests, prod via CI only ([cc0ea21](https://github.com/voidcorp-core/void-harness/commit/cc0ea215ef8f71f269f7a932154d5adf491e4aed))
* **ticket-runner:** apply migrations to dev/local before tests, prod via CI only ([deaadc6](https://github.com/voidcorp-core/void-harness/commit/deaadc60fb48dc3b5509be5d955be749297f38d3))


### Bug Fixes

* **enforce:** allow a lockfile change accompanied by a manifest change (DEV-393 follow-up) ([4b04403](https://github.com/voidcorp-core/void-harness/commit/4b04403b931397648d978846835d7ee8f2fd4a25))
* **enforce:** allow a lockfile change accompanied by a manifest change (DEV-393 follow-up) ([16eb1bd](https://github.com/voidcorp-core/void-harness/commit/16eb1bdc7c30ae795a1dba50d8d312690b3f0300))
* **hooks:** normalize absolute tool paths against the project root ([#62](https://github.com/voidcorp-core/void-harness/issues/62)) ([73c65a1](https://github.com/voidcorp-core/void-harness/commit/73c65a1baf3a09563ad04b7ced2fc69861703119))
* **hooks:** rewrite no-as-cast-grep in POSIX ERE, not PCRE ([#64](https://github.com/voidcorp-core/void-harness/issues/64)) ([e3b71eb](https://github.com/voidcorp-core/void-harness/commit/e3b71eb1b965bd0dc0e91d3c9fda58971a395a68))


### Performance Improvements

* **harness:** token-frugality audit + tier type-design-analyzer/estimator down (DEV-403) ([ac660dd](https://github.com/voidcorp-core/void-harness/commit/ac660ddde3189427ca642a5f3e8b9a436b6e2755))
* **harness:** token-frugality audit + tier type-design-analyzer/estimator down (DEV-403) ([143e395](https://github.com/voidcorp-core/void-harness/commit/143e395fb2b715364a16104a132f8ec83f7cfbbe))

## [0.15.0](https://github.com/voidcorp-core/void-harness/compare/v0.14.0...v0.15.0) (2026-07-06)


### Features

* **graph:** close cost/behavior telemetry blind spots via activation mode ([#58](https://github.com/voidcorp-core/void-harness/issues/58)) ([72abada](https://github.com/voidcorp-core/void-harness/commit/72abada6e165ebe71b323b0e02f6d41096fa7f21))
* **graph:** telemetry-gap finding collapses unrecorded firing kinds ([#61](https://github.com/voidcorp-core/void-harness/issues/61)) ([7019b9b](https://github.com/voidcorp-core/void-harness/commit/7019b9ba6b8c9b637918d0829f3a77cb04c545cb))


### Bug Fixes

* **activation-meter:** count Agent spawns as kind=agent ([#60](https://github.com/voidcorp-core/void-harness/issues/60)) ([f6e40bf](https://github.com/voidcorp-core/void-harness/commit/f6e40bf412dc6634459f8d3d87b9162079d92fd1))

## [0.14.0](https://github.com/voidcorp-core/void-harness/compare/v0.13.1...v0.14.0) (2026-07-02)


### Features

* backlog-autopilot --auto-merge MVP (attended batch) ([#51](https://github.com/voidcorp-core/void-harness/issues/51)) ([d5d3e44](https://github.com/voidcorp-core/void-harness/commit/d5d3e44086c287b03daeb9c86564d74c717006d0))
* **core:** ticket-runner UX/UI pass leads with impeccable for interface craft ([#52](https://github.com/voidcorp-core/void-harness/issues/52)) ([34c1e8d](https://github.com/voidcorp-core/void-harness/commit/34c1e8d689b0d4109756db70a7fa7b42e7472ed2))
* graph consumer delivery — /void-graph (sub-project B) ([#50](https://github.com/voidcorp-core/void-harness/issues/50)) ([889c65b](https://github.com/voidcorp-core/void-harness/commit/889c65b1cd7235491a519909a5fa716dc65b4770))
* graph studio cost viz — cost layer + panel (sub-project C) ([#54](https://github.com/voidcorp-core/void-harness/issues/54)) ([cec38d3](https://github.com/voidcorp-core/void-harness/commit/cec38d3ea076b5a0dab97b64e7f9d813e7944b8e))
* **harness-graph:** 'enforces' edge kind + wire agents/hooks into the graph ([#57](https://github.com/voidcorp-core/void-harness/issues/57)) ([af42d1b](https://github.com/voidcorp-core/void-harness/commit/af42d1b1a1cf97c970287a4bfe755d369ca70eb2))
* **harness-graph:** graph cost profiler (sub-project A) ([#48](https://github.com/voidcorp-core/void-harness/issues/48)) ([2a21536](https://github.com/voidcorp-core/void-harness/commit/2a21536493932112ca3731eb5108f3126b0c6477))


### Bug Fixes

* **core:** isolate the backlog-autopilot reconcile agent in its own worktree ([#53](https://github.com/voidcorp-core/void-harness/issues/53)) ([01d11e2](https://github.com/voidcorp-core/void-harness/commit/01d11e247486f0d1d9ced3f0b387e0646b423b04))
* harden graph live (loopback + scoped CORS) + release gates + stale docs ([#55](https://github.com/voidcorp-core/void-harness/issues/55)) ([91a6cbb](https://github.com/voidcorp-core/void-harness/commit/91a6cbbfa6dd4acf7dc87d29b5fe27638f71680b))

## [0.13.1](https://github.com/voidcorp-core/void-harness/compare/v0.13.0...v0.13.1) (2026-06-29)


### Bug Fixes

* **release:** pass the released tag to void-plugins bump-shas ([d18f924](https://github.com/voidcorp-core/void-harness/commit/d18f924701e1b0630e0744e8deda13aa78612f30))
* **release:** pass the released tag to void-plugins bump-shas ([b71afe2](https://github.com/voidcorp-core/void-harness/commit/b71afe217bb2f314daf7f12bb7f666d9a5b270f5))

## [0.13.0](https://github.com/voidcorp-core/void-harness/compare/v0.12.1...v0.13.0) (2026-06-29)


### Features

* **cli:** void-harness graph build|check|audit ([35f140e](https://github.com/voidcorp-core/void-harness/commit/35f140e6d11aa889ee2471b6031a9e1b73657763))
* **graph-behavior:** behavioral analysis core (advisory findings) ([87364c3](https://github.com/voidcorp-core/void-harness/commit/87364c31d337c49922e8abfec8ac9b5b966cc181))
* **graph-behavior:** declarable triggers in skill frontmatter -&gt; GraphNode ([d9463fc](https://github.com/voidcorp-core/void-harness/commit/d9463fcb5b454e6c8a0a6a963f012449892e5e0c))
* **graph-behavior:** graph behavior CLI report (advisory) ([bb3f00a](https://github.com/voidcorp-core/void-harness/commit/bb3f00ae7a5c9a035525837573ba16eea503adeb))
* **graph-behavior:** M8 should-have-fired + dead-node analysis ([1030eaf](https://github.com/voidcorp-core/void-harness/commit/1030eafa76c2641feae6b2ce4829a87f4bc7cf0e))
* **graph-behavior:** pure activation parse + trigger matching ([e11681b](https://github.com/voidcorp-core/void-harness/commit/e11681b502d031d02c3eef9c37653d964b3e564f))
* **graph-behavior:** seed declarative triggers on six path-driven skills ([dff4e54](https://github.com/voidcorp-core/void-harness/commit/dff4e54a6da87f51fcbf35e86e1ee99632b82582))
* **graph-live:** brancher activation-meter sur PreToolUse * + mirror + modele ([d0c2e1c](https://github.com/voidcorp-core/void-harness/commit/d0c2e1cb96e5edf935a8bf197792f9ebad6f0b0d))
* **graph-live:** calque live studio -- EventSource + pulse via frameAt ([f745f56](https://github.com/voidcorp-core/void-harness/commit/f745f56f5369ca760990960245c52a6a4b587b55))
* **graph-live:** coeur pur du calque live (frameAt unique) ([92fdb98](https://github.com/voidcorp-core/void-harness/commit/92fdb98328987522cb6deb5d936b0daf5e172479))
* **graph-live:** endpoint /history borne pour le replay ([87146eb](https://github.com/voidcorp-core/void-harness/commit/87146eb565d6339f6ddb7303f14670ccb9019de1))
* **graph-live:** etat pur du scrubber ([a8b5467](https://github.com/voidcorp-core/void-harness/commit/a8b54670801a73b49a533821edaadaedbbec0630))
* **graph-live:** graph live -- serveur SSE data-only (model + events) ([625496e](https://github.com/voidcorp-core/void-harness/commit/625496eed40b786c6a0daff91cb7e7397894bba2))
* **graph-live:** helpers purs de lecture du flux d'activations ([9176e7b](https://github.com/voidcorp-core/void-harness/commit/9176e7b7e3e3da84014275df0e83b353930fb225))
* **graph-live:** meter universel d'activations (absorbe skill-usage-meter) ([15f7779](https://github.com/voidcorp-core/void-harness/commit/15f7779c021292ca145cd88cd2ea8bb675aeeba4))
* **graph-live:** scrubber de replay timeline (live/replay unifies via frameAt) ([f99d97b](https://github.com/voidcorp-core/void-harness/commit/f99d97b32bf6d18fdb7e7e350129d1b2c5b725f0))
* **graph-studio:** analysis layer (halos, muted orphans, overlap edges) ([a47d626](https://github.com/voidcorp-core/void-harness/commit/a47d626adb963701fc3db93195fcd1ca41fdb908))
* **graph-studio:** build static model/usage/findings/workflows blobs ([98ed0d8](https://github.com/voidcorp-core/void-harness/commit/98ed0d81887f69bfd044a2dab70b8b749572d59a))
* **graph-studio:** click-to-focus ego-network, hub count badges, decluttered labels ([38ff4b0](https://github.com/voidcorp-core/void-harness/commit/38ff4b0ec75d18bb8a1d5403f1dab18753bad3c0))
* **graph-studio:** derive analysis overlays from findings + tension edges ([c6631f0](https://github.com/voidcorp-core/void-harness/commit/c6631f008ddd7b817306e6c9ac51ebabac64f63b))
* **graph-studio:** holographic HUD pass (bloom, fog, reticle, boot intro) ([32c0ee3](https://github.com/voidcorp-core/void-harness/commit/32c0ee3e585769df57a8ef61b32b1d8537d8508e))
* **graph-studio:** make Flow and Workflows layer toggles functional ([bfc5462](https://github.com/voidcorp-core/void-harness/commit/bfc54627c61dec36dcb9c0322ece5f2d2efa0d10))
* **graph-studio:** orchestrator-centric 3D orbital view with progressive disclosure ([be24688](https://github.com/voidcorp-core/void-harness/commit/be246880a7ede6e1b42826c2bb7ece13d785bf87))
* **graph-studio:** partition edge kinds into the four filter families ([bf723d0](https://github.com/voidcorp-core/void-harness/commit/bf723d0a1666b96b3b15136f27371af5f226b6fe))
* **graph-studio:** Plan B — holographic 3D view of the harness graph ([b4194e9](https://github.com/voidcorp-core/void-harness/commit/b4194e9a78d9abeade8884a1b50861bbc36ca8f0))
* **graph-studio:** pure layer/family/search selection ([c37eae5](https://github.com/voidcorp-core/void-harness/commit/c37eae532379ceaa3db44711fee366ad0cb99a8c))
* **graph-studio:** pure visual encoding (size/color/halo/cluster) ([831ffd4](https://github.com/voidcorp-core/void-harness/commit/831ffd46e1bcc1be91a610a64e1802e079d83aa6))
* **graph-studio:** render the structural 3D graph (force-graph + camera) ([bf29b93](https://github.com/voidcorp-core/void-harness/commit/bf29b93d0f82039ea6556266e30adbfb31a73aae))
* **graph-studio:** scaffold the Vite + TS app and wire it into the workspace ([6fb7fd2](https://github.com/voidcorp-core/void-harness/commit/6fb7fd2b87f4433c77c1476a67a76c9464c9f963))
* **graph-studio:** side panel, layer/family/search controls ([5efee90](https://github.com/voidcorp-core/void-harness/commit/5efee908da55363dbab322ee5803d9fd036476c6))
* **graph-studio:** structural flow impulse (GSAP particle bursts) ([7612811](https://github.com/voidcorp-core/void-harness/commit/76128111246465d985fac62ba22aeb36720290ae))
* **graph-studio:** workflow-def viewer (phase schematic + neighbors) ([296a526](https://github.com/voidcorp-core/void-harness/commit/296a52697be2418563d37246eef1c3cdce54398c))
* **harness-graph:** analysis finding type + detector signature ([61505dc](https://github.com/voidcorp-core/void-harness/commit/61505dc66eb05ab65630b7d45e3cb2ca27f387b8))
* **harness-graph:** assemble + stably serialize the model ([a299c16](https://github.com/voidcorp-core/void-harness/commit/a299c1698a31a52b612cad3b472ec7a989f5127b))
* **harness-graph:** derive mechanical edges (companion/invokes/extends) ([bb2340e](https://github.com/voidcorp-core/void-harness/commit/bb2340e72e189b7c7e1078ac8c012e38b649f09f))
* **harness-graph:** derive nodes from core + packs ([a5cdd62](https://github.com/voidcorp-core/void-harness/commit/a5cdd62ac6ba0af6f4663a2541fef792bf802466))
* **harness-graph:** detect broken routes / dangling refs ([45b7a84](https://github.com/voidcorp-core/void-harness/commit/45b7a8430cc85db2dd0e681836b647334010dcee))
* **harness-graph:** detect orphan nodes, composing usage data ([8a14df4](https://github.com/voidcorp-core/void-harness/commit/8a14df4b7d812f51aa169bdd18fa5845fc826408))
* **harness-graph:** detect routes-to cycles ([94693cb](https://github.com/voidcorp-core/void-harness/commit/94693cb1a43fc7fe09545375075c7c9bcc87fd6e))
* **harness-graph:** detector registry + analyze aggregate ([4f779ca](https://github.com/voidcorp-core/void-harness/commit/4f779caf7ca34189fede1c5d1ca40fd8dbeec566))
* **harness-graph:** graph kernel + analyses + CLI + telemetry seed (Plan A) ([557fe39](https://github.com/voidcorp-core/void-harness/commit/557fe39e6dbaad1ebb1f95c4a248a7bdc9a0f700))
* **harness-graph:** graph model types + stable node ids ([be3783e](https://github.com/voidcorp-core/void-harness/commit/be3783e7025a4f0be9469cb7479327dfbf4ac143))
* **harness-graph:** lexical overlap detector (anti-bloat signal) ([2a5b516](https://github.com/voidcorp-core/void-harness/commit/2a5b51643c2e14b173e2020f9a992af92cf3d4f7))
* **harness-graph:** load declared semantic relations from yaml ([2c01b49](https://github.com/voidcorp-core/void-harness/commit/2c01b49f6d89f683b4e2cfa9cdbe993431f86746))
* **harness-graph:** pure frontmatter + LOC readers ([3172024](https://github.com/voidcorp-core/void-harness/commit/3172024e840ac9a718b0ccfcd520775b75379331))
* **harness-graph:** scaffold the graph kernel package ([9f4ac20](https://github.com/voidcorp-core/void-harness/commit/9f4ac20a49545fba2068d8efc8bf6090dc2a9a60))
* **harness-graph:** seed declared relations + first model.json ([a09a06e](https://github.com/voidcorp-core/void-harness/commit/a09a06eb7b93311dd333f9f5e1b9ffddbbf743b1))
* **harness:** seed enriched activation telemetry (jsonl) ([7195489](https://github.com/voidcorp-core/void-harness/commit/719548963035b7a669bde54ceb4784d6a37f4483))
* **skills:** ticket-writer + ticket-runner expert cycle; backlog-autopilot delegates ([1d8cf09](https://github.com/voidcorp-core/void-harness/commit/1d8cf09a03626af464026cef8e04b71cd1f2d081))
* **skills:** ticket-writer + ticket-runner expert cycle; backlog-autopilot delegates ([3fe5698](https://github.com/voidcorp-core/void-harness/commit/3fe569816656b1fb8734ab49e7bb1ed9826beb43))


### Bug Fixes

* **graph-behavior:** drop tdd from trigger seed (at anti-bloat 400-LOC cap) ([ad06674](https://github.com/voidcorp-core/void-harness/commit/ad06674de2dbad1df16eaccf8858bbbd3430b5cd))
* **graph-studio:** align three with 3d-force-graph internal copy ([2eacdb5](https://github.com/voidcorp-core/void-harness/commit/2eacdb5c5906c72af3fa76fa8f353c38e3ad4f2c))
* **graph-studio:** guard camera focus against an at-origin node ([9a7cd6a](https://github.com/voidcorp-core/void-harness/commit/9a7cd6aa612159d06575808efd3c96d654c50788))
* **graph-studio:** keep search focus on redraw, add noopener to source link ([91698d1](https://github.com/voidcorp-core/void-harness/commit/91698d17399d672fcbe8d61a858f7c4ee9252046))
* **graph-studio:** repair focus camera and global search from re-review ([38d1374](https://github.com/voidcorp-core/void-harness/commit/38d137447c449474e5b4651e0db3e22f3ae2e037))
* **graph-studio:** tune bloom for legibility over spectacle ([77a64dd](https://github.com/voidcorp-core/void-harness/commit/77a64dd0c33d21391d9ccabcf341bd0a764bb249))
* **harness-graph:** correct pack-skills path and prefer source over mirror ([b1837c9](https://github.com/voidcorp-core/void-harness/commit/b1837c931eb7b116d1cba5e0d8ce4e16447bdd86))
* **harness-graph:** make rel() clone-dir-agnostic; use ICU-stable cmp sort ([458dfec](https://github.com/voidcorp-core/void-harness/commit/458dfecf897e0795e01835fa8d12d600a4006af2))
* **release:** add harness-graph to the version lockstep ([401c326](https://github.com/voidcorp-core/void-harness/commit/401c32654e8204e94a5f738c9cea4b0e53643c92))
* **release:** add harness-graph to the version lockstep ([380e1cc](https://github.com/voidcorp-core/void-harness/commit/380e1ccf2ac5ce72ab103dede780d2587b5ea363))

## [0.12.1](https://github.com/voidcorp-core/void-harness/compare/v0.12.0...v0.12.1) (2026-06-26)


### Bug Fixes

* **backlog:** configurable autopilot auto-merge method, default merge ([8622076](https://github.com/voidcorp-core/void-harness/commit/8622076942a571814e9e2ec93e8d65714a2873ca))
* **backlog:** make autopilot auto-merge method configurable, default merge ([381a713](https://github.com/voidcorp-core/void-harness/commit/381a713aa468d44ff04fbff3315afb99f4ca922e)), closes [#31](https://github.com/voidcorp-core/void-harness/issues/31)

## [0.12.0](https://github.com/voidcorp-core/void-harness/compare/v0.11.0...v0.12.0) (2026-06-22)


### Features

* **cli:** autopilot long-run loop, budget breaker and operator subcommands ([b2046c5](https://github.com/voidcorp-core/void-harness/commit/b2046c554c7b70bc23ad10b1a56b6a681a64e6ac))
* **cli:** base detection and per-cluster stacked branch base ([b306b49](https://github.com/voidcorp-core/void-harness/commit/b306b49113c505d77b188efa693582c3b1c57736))
* **cli:** cluster-aware autopilot plan with batch-of-4 default ([f1095db](https://github.com/voidcorp-core/void-harness/commit/f1095dbfa729d822ec6cdaaa6c1b9cfafe6dd2a7))
* **cli:** cluster-detect with footprint corroboration, size cap and split ([dd9c7b0](https://github.com/voidcorp-core/void-harness/commit/dd9c7b067549cca0ea7835e8db901928bf6df7c7))
* **cli:** cluster-order with topological sort and T2 worktree isolation ([0dad969](https://github.com/voidcorp-core/void-harness/commit/0dad969df04d9ee87121af520e79826c67245791))
* **cli:** durable run state with atomic writes and remote reconciliation ([fb71a9d](https://github.com/voidcorp-core/void-harness/commit/fb71a9d5b9d041f5cf9f4eb692f0193169324218))
* **cli:** red-handling excludes a red ticket and its dependents ([40898e1](https://github.com/voidcorp-core/void-harness/commit/40898e1bc1848c6fdf6317e359531056da641e5d))
* **cli:** risk-gated sequential stacked auto-merge state machine ([968f6c2](https://github.com/voidcorp-core/void-harness/commit/968f6c2f7be19327245348a8ecc361f1219dd581))
* consolidate backlog skills into backlog-autopilot ([d74fd2b](https://github.com/voidcorp-core/void-harness/commit/d74fd2bc15d60b866d4aa56d087b5291d5eb6fdc))
* **skills:** adaptive per-ticket quality cycle and two-level review ([e471536](https://github.com/voidcorp-core/void-harness/commit/e4715367cb0357945ae242493bec1dd4a8aa110c))
* **skills:** cluster engine in the backlog-autopilot Workflow ([717e976](https://github.com/voidcorp-core/void-harness/commit/717e976e7a247bffc76044e88e57258818ca6916))

## [0.11.0](https://github.com/voidcorp-core/void-harness/compare/v0.10.0...v0.11.0) (2026-06-19)


### Features

* implement void-harness audit + feedback push (issue [#17](https://github.com/voidcorp-core/void-harness/issues/17) cluster C) ([5fc5d5b](https://github.com/voidcorp-core/void-harness/commit/5fc5d5b186219734e5d5718c5ea6264872dc1c37))
* **pack-server:** testing-server-modules skill (issue [#17](https://github.com/voidcorp-core/void-harness/issues/17) B3) ([f3e10d5](https://github.com/voidcorp-core/void-harness/commit/f3e10d5c44e0325b4ad3fc5a3f33a88a7c5827a6))
* trigger void-plugins pin bump on release ([ddf883a](https://github.com/voidcorp-core/void-harness/commit/ddf883a53e50bc876c1154ba69f86a7cb86be484))
* trigger void-plugins pin bump on release ([b3e0de2](https://github.com/voidcorp-core/void-harness/commit/b3e0de28368611aafff3e70ef483a6716dd63c1e))
* void-harness audit + feedback push CLI (issue [#17](https://github.com/voidcorp-core/void-harness/issues/17) cluster C) ([2d4105c](https://github.com/voidcorp-core/void-harness/commit/2d4105c20b110c66ad38fb09559254b550a37318))


### Bug Fixes

* **block-dangerous-bash:** scope force-push match to the push command ([b0a87c5](https://github.com/voidcorp-core/void-harness/commit/b0a87c575bf3d060c20bb798cb18e8ede817a016))
* issue [#17](https://github.com/voidcorp-core/void-harness/issues/17) cluster B — FormData, fail-soft HTTP, server-only testing (guidance) ([27019ee](https://github.com/voidcorp-core/void-harness/commit/27019ee9d862254db7b9202ce40d74678d2881e1))
* **server-action,form-pattern:** multi-value FormData guidance (issue [#17](https://github.com/voidcorp-core/void-harness/issues/17) B2) ([f8c67d1](https://github.com/voidcorp-core/void-harness/commit/f8c67d1aa5497d58d62539842fe720ecfdfa99f4))

## [0.10.0](https://github.com/voidcorp-core/void-harness/compare/v0.9.0...v0.10.0) (2026-06-19)


### Features

* block-protected-push hook as the secondary push net ([7ba3d06](https://github.com/voidcorp-core/void-harness/commit/7ba3d06332850ae864b0f8cdd5c42d5394a94936))
* harden the backlog-loop git + allowlist gates (issue [#17](https://github.com/voidcorp-core/void-harness/issues/17) cluster A) ([609f0fa](https://github.com/voidcorp-core/void-harness/commit/609f0fa08f1af6694e781c8625a1b87f54424e5a))
* isolate each backlog-loop iteration in its own git worktree ([97dfb5f](https://github.com/voidcorp-core/void-harness/commit/97dfb5f5c6535de8f114d9c067beeabdfb8aaef7))
* move push + PR creation into the trusted orchestrator ([8d9efdc](https://github.com/voidcorp-core/void-harness/commit/8d9efdc5bb325483a7b9659dc40bb125b47131e6))
* narrow the autonomous git allowlist + block exec rebase flags ([c1f0e59](https://github.com/voidcorp-core/void-harness/commit/c1f0e59a8b75e787c1b4fb6213eb91667f090b02))
* refuse an unprotected base branch at backlog-loop preflight ([2ae2584](https://github.com/voidcorp-core/void-harness/commit/2ae2584e69985a7be91e690efb6ce9e738397008))
* rewrite the worker prompt as commit-only ([87143ed](https://github.com/voidcorp-core/void-harness/commit/87143ed99b8462931fa534bdf06adcf6a6830b92))
* **source-driven-development:** offline branch + blocking source-debt ([5ff20d0](https://github.com/voidcorp-core/void-harness/commit/5ff20d0e4c03cce2549f7111cb4cd5d90bfb3754))


### Bug Fixes

* address code-review findings on the loop hardening (issue [#17](https://github.com/voidcorp-core/void-harness/issues/17)) ([9568ba5](https://github.com/voidcorp-core/void-harness/commit/9568ba5808ef54f227a642d2175e2d06157f139c))
* **backlog-batch:** parse args delivered as a JSON string (issue [#21](https://github.com/voidcorp-core/void-harness/issues/21)) ([5492ce5](https://github.com/voidcorp-core/void-harness/commit/5492ce5ac134faaf71b8035942c495904b1c7d80))

## [0.9.0](https://github.com/voidcorp-core/void-harness/compare/v0.8.2...v0.9.0) (2026-06-18)


### Features

* backlog-batch — attended parallel ticket drain (worktree subagents → integration PR) ([44b076e](https://github.com/voidcorp-core/void-harness/commit/44b076e324a7b2f1975b7d0df7f1209a2fa9232b))
* **core:** backlog-batch skill + /harness:backlog-batch command ([817f822](https://github.com/voidcorp-core/void-harness/commit/817f822ad4fcfb756a0cedb2c93b683abfa1a418))

## [0.8.2](https://github.com/voidcorp-core/void-harness/compare/v0.8.1...v0.8.2) (2026-06-18)


### Bug Fixes

* **backlog-loop:** grant the worker the Linear MCP it is told to use ([a02f782](https://github.com/voidcorp-core/void-harness/commit/a02f78286aa641d0733b0bb7228a1556eca04b5f))
* **backlog-loop:** grant the worker the Linear MCP it is told to use ([d0a63d5](https://github.com/voidcorp-core/void-harness/commit/d0a63d5c83b74c6ccde96b06bdb843db2eda0065))

## [0.8.1](https://github.com/voidcorp-core/void-harness/compare/v0.8.0...v0.8.1) (2026-06-18)


### Bug Fixes

* **commands:** /void-* invoke the void-harness binary, not npx (404) ([7ac81d8](https://github.com/voidcorp-core/void-harness/commit/7ac81d807d7991a096ebf740a879ab51f453f02d))
* **commands:** invoke void-harness binary, not npx @voidcorp/harness ([d65f729](https://github.com/voidcorp-core/void-harness/commit/d65f729e69e5d81a1054885f4025b771a30d60bf))

## [0.8.0](https://github.com/voidcorp-core/void-harness/compare/v0.7.0...v0.8.0) (2026-06-18)


### Features

* **cli:** backlog-loop command skeleton with --help and --dry-run ([1d75b2b](https://github.com/voidcorp-core/void-harness/commit/1d75b2b6df51ffc1c2e98358756c788f14379a04))
* **cli:** backlog-loop config resolution ([cf27444](https://github.com/voidcorp-core/void-harness/commit/cf2744446e877be7009cff4e47087e55991dcfef))
* **cli:** backlog-loop run loop, circuit-break, and dense summary ([7d43138](https://github.com/voidcorp-core/void-harness/commit/7d43138295c0eabcb57c35b6fbcef830789c20e4))
* **cli:** backlog-loop stream-json parser to domain events ([4164f72](https://github.com/voidcorp-core/void-harness/commit/4164f7258cdebf92d75a837a4b38b0fd666a6e22))
* **cli:** first-run wizard for backlog-loop config ([6a8e53e](https://github.com/voidcorp-core/void-harness/commit/6a8e53e4e7e60cc5a4ebdb9869777f1905afc680))
* **cli:** single-iteration orchestrator + live append-only renderer ([3ea5b99](https://github.com/voidcorp-core/void-harness/commit/3ea5b99ec3084e80725d76403a446a74de8361b5))
* **cli:** subscription billing guard for backlog-loop ([6198906](https://github.com/voidcorp-core/void-harness/commit/61989069164b3eef013de052b43221f2b8d4af29))
* **cli:** wire backlog-loop command to the live loop ([ad69c1d](https://github.com/voidcorp-core/void-harness/commit/ad69c1deea60f33f6a11e5a5605a43eca99c9bdc))
* **core:** /void-backlog-loop slash-command ([8de39d3](https://github.com/voidcorp-core/void-harness/commit/8de39d335cd56a1b2e55ecb7b061290b21c1c1cf))


### Bug Fixes

* rename void: skill prefixes in .source metadata ([de8ac5f](https://github.com/voidcorp-core/void-harness/commit/de8ac5f60e9637bfbc10f851857cb5fd5b76c53e))
* rename void: skill prefixes in .source metadata files ([3cc7ccc](https://github.com/voidcorp-core/void-harness/commit/3cc7ccc0ebbb16a4b497e0b369407ea232bb0b57))

## [0.7.0](https://github.com/voidcorp-core/void-harness/compare/v0.6.1...v0.7.0) (2026-06-12)


### ⚠ BREAKING CHANGES

* skill prefixes /void:* -> /harness:*, enabledPlugins ids void*@void-harness -> harness*@voidcorp, marketplace registration now targets voidcorp-core/void-plugins. Consumers re-run init.

### Features

* rename to harness@voidcorp and move the catalog to void-plugins ([af3b0f0](https://github.com/voidcorp-core/void-harness/commit/af3b0f08b24e80db848fc54d910551c720e7c7fd))

## [0.6.1](https://github.com/voidcorp-core/void-harness/compare/v0.6.0...v0.6.1) (2026-06-05)


### Bug Fixes

* **cli:** check points to void-harness update (clears the drift it measures) ([b1139aa](https://github.com/voidcorp-core/void-harness/commit/b1139aab97691286b360aa5f07573b09a3c9f755))
* **cli:** check suggests `void-harness update`, not `/plugin marketplace update` ([d3d7fee](https://github.com/voidcorp-core/void-harness/commit/d3d7fee6a15f2acdbd1949c29c946fd7d64fcd1c))
