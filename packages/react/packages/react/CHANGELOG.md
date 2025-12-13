# Changelog

## [1.2.0](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-react-v1.1.3...loro-mirror-react-v1.2.0) (2025-12-13)


### Miscellaneous Chores

* **loro-mirror-react:** Synchronize loro-mirror-suite versions

## [1.1.3](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-react-v1.1.2...loro-mirror-react-v1.1.3) (2025-12-13)


### Bug Fixes

* use explicit .js extensions for ESM-compliant imports ([#58](https://github.com/loro-dev/loro-mirror/issues/58)) ([d6ee6fe](https://github.com/loro-dev/loro-mirror/commit/d6ee6fe6f9e0781b6f8440075115d6315e3c1594))

## [1.1.2](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-react-v1.1.1...loro-mirror-react-v1.1.2) (2025-12-06)


### Miscellaneous Chores

* **loro-mirror-react:** Synchronize loro-mirror-suite versions

## [1.1.1](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-react-v1.1.0...loro-mirror-react-v1.1.1) (2025-10-27)


### Bug Fixes

* add compatibility declare for react 19 ([35aa319](https://github.com/loro-dev/loro-mirror/commit/35aa3192f3902f8595f6f34a6b79c4a60e6cf78c))

## [1.1.0](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-react-v1.0.4...loro-mirror-react-v1.1.0) (2025-10-14)


### Miscellaneous Chores

* **loro-mirror-react:** Synchronize loro-mirror-suite versions

## [1.0.4](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-react-v1.0.3...loro-mirror-react-v1.0.4) (2025-10-12)


### Miscellaneous Chores

* **loro-mirror-react:** Synchronize loro-mirror-suite versions

## [1.0.3](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-react-v1.0.2...loro-mirror-react-v1.0.3) (2025-09-28)

### Miscellaneous Chores

- **loro-mirror-react:** Synchronize loro-mirror-suite versions

## [1.0.2](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-react-v1.0.1...loro-mirror-react-v1.0.2) (2025-09-25)

### Miscellaneous Chores

- **loro-mirror-react:** Synchronize loro-mirror-suite versions

## [1.0.1](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-react-v1.0.0...loro-mirror-react-v1.0.1) (2025-09-22)

### Miscellaneous Chores

- **loro-mirror-react:** Synchronize loro-mirror-suite versions

## [1.0.0](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-react-v0.2.0...loro-mirror-react-v1.0.0) (2025-09-22)

### ⚠ BREAKING CHANGES

- make events synchronous by using loro-crdt@1.8.0 ([#39](https://github.com/loro-dev/loro-mirror/issues/39))

### Features

- make events synchronous by using loro-crdt@1.8.0 ([#39](https://github.com/loro-dev/loro-mirror/issues/39)) ([27aa95b](https://github.com/loro-dev/loro-mirror/commit/27aa95ba135e56ee3e3f56fb7f1a18cf448938f7))

## [0.2.0](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-react-v0.1.1...loro-mirror-react-v0.2.0) (2025-09-17)

### Features

- **core,react:** support draft-style setState; honor schema.Ignore; sync docs ([6cda9a2](https://github.com/loro-dev/loro-mirror/commit/6cda9a2c46b957005f13372c34f4063fc1de197a))
- **core:** add withCid ($cid) support for maps and tree node.data ([#19](https://github.com/loro-dev/loro-mirror/issues/19)) ([b031b09](https://github.com/loro-dev/loro-mirror/commit/b031b096ecb4c4db54529bfd2a9b04c49ba9b0c0))
- jotai binding ([#13](https://github.com/loro-dev/loro-mirror/issues/13)) ([5a381ab](https://github.com/loro-dev/loro-mirror/commit/5a381abd96e2c77f7f56bb6735d7e60a5f5edd6d))
- LoroTree ([#16](https://github.com/loro-dev/loro-mirror/issues/16)) ([3990702](https://github.com/loro-dev/loro-mirror/commit/399070207f8c408c4f381ac5303b6ff0dd7acfa3))
- make setState async to avoid correctness problem ([#24](https://github.com/loro-dev/loro-mirror/issues/24)) ([cc234c3](https://github.com/loro-dev/loro-mirror/commit/cc234c3a1648704b5b44427e0728514cb7fa4832))
- state update tagging, default container inferring, fix: container initialization, misc ([#6](https://github.com/loro-dev/loro-mirror/issues/6)) ([ab41789](https://github.com/loro-dev/loro-mirror/commit/ab41789358b5679c1d8417da1a9597386b910ae8))

### Bug Fixes

- **core:** prevent divergence with null map values ([#18](https://github.com/loro-dev/loro-mirror/issues/18)) ([3fc3965](https://github.com/loro-dev/loro-mirror/commit/3fc3965d02851e64903aab1ff119f69111342861))
- initState shuold not override doc init state ([dc59fa8](https://github.com/loro-dev/loro-mirror/commit/dc59fa8975313afa49ebad1097a946c01b981b57))
- jotai sub ([90944c8](https://github.com/loro-dev/loro-mirror/commit/90944c8b2d399dd781fe73f1b591567e25cecd11))
- loro-mirror should be peerDeps for react pkg ([5d0b6d3](https://github.com/loro-dev/loro-mirror/commit/5d0b6d3753ba9ecd2cebfcb6d869e1b10cafb134))
- make all current tests pass ([6a500bb](https://github.com/loro-dev/loro-mirror/commit/6a500bbb1419467fe48a3067b9e7428485697e1a))
- make withCid as default behavior and rm this config ([#23](https://github.com/loro-dev/loro-mirror/issues/23)) ([b97ba42](https://github.com/loro-dev/loro-mirror/commit/b97ba4209ae0057c940927bee9c279bb1327302f))
- movable list diff issue ([84c308c](https://github.com/loro-dev/loro-mirror/commit/84c308c7392b96885d522729a18c24e09de70f36))

## [0.1.0](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-react-v0.1.0...loro-mirror-react-v0.1.0) (2025-09-12)

### Features

- **core,react:** support draft-style setState; honor schema.Ignore; sync docs ([6cda9a2](https://github.com/loro-dev/loro-mirror/commit/6cda9a2c46b957005f13372c34f4063fc1de197a))
- **core:** add withCid ($cid) support for maps and tree node.data ([#19](https://github.com/loro-dev/loro-mirror/issues/19)) ([b031b09](https://github.com/loro-dev/loro-mirror/commit/b031b096ecb4c4db54529bfd2a9b04c49ba9b0c0))
- jotai binding ([#13](https://github.com/loro-dev/loro-mirror/issues/13)) ([5a381ab](https://github.com/loro-dev/loro-mirror/commit/5a381abd96e2c77f7f56bb6735d7e60a5f5edd6d))
- LoroTree ([#16](https://github.com/loro-dev/loro-mirror/issues/16)) ([3990702](https://github.com/loro-dev/loro-mirror/commit/399070207f8c408c4f381ac5303b6ff0dd7acfa3))
- make setState async to avoid correctness problem ([#24](https://github.com/loro-dev/loro-mirror/issues/24)) ([cc234c3](https://github.com/loro-dev/loro-mirror/commit/cc234c3a1648704b5b44427e0728514cb7fa4832))
- state update tagging, default container inferring, fix: container initialization, misc ([#6](https://github.com/loro-dev/loro-mirror/issues/6)) ([ab41789](https://github.com/loro-dev/loro-mirror/commit/ab41789358b5679c1d8417da1a9597386b910ae8))

### Bug Fixes

- **core:** prevent divergence with null map values ([#18](https://github.com/loro-dev/loro-mirror/issues/18)) ([3fc3965](https://github.com/loro-dev/loro-mirror/commit/3fc3965d02851e64903aab1ff119f69111342861))
- initState shuold not override doc init state ([dc59fa8](https://github.com/loro-dev/loro-mirror/commit/dc59fa8975313afa49ebad1097a946c01b981b57))
- jotai sub ([90944c8](https://github.com/loro-dev/loro-mirror/commit/90944c8b2d399dd781fe73f1b591567e25cecd11))
- make all current tests pass ([6a500bb](https://github.com/loro-dev/loro-mirror/commit/6a500bbb1419467fe48a3067b9e7428485697e1a))
- make withCid as default behavior and rm this config ([#23](https://github.com/loro-dev/loro-mirror/issues/23)) ([b97ba42](https://github.com/loro-dev/loro-mirror/commit/b97ba4209ae0057c940927bee9c279bb1327302f))
- movable list diff issue ([84c308c](https://github.com/loro-dev/loro-mirror/commit/84c308c7392b96885d522729a18c24e09de70f36))

## [0.1.0](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-react-v0.1.0...loro-mirror-react-v0.1.0) (2025-09-12)

### Features

- **core,react:** support draft-style setState; honor schema.Ignore; sync docs ([6cda9a2](https://github.com/loro-dev/loro-mirror/commit/6cda9a2c46b957005f13372c34f4063fc1de197a))
- **core:** add withCid ($cid) support for maps and tree node.data ([#19](https://github.com/loro-dev/loro-mirror/issues/19)) ([b031b09](https://github.com/loro-dev/loro-mirror/commit/b031b096ecb4c4db54529bfd2a9b04c49ba9b0c0))
- jotai binding ([#13](https://github.com/loro-dev/loro-mirror/issues/13)) ([5a381ab](https://github.com/loro-dev/loro-mirror/commit/5a381abd96e2c77f7f56bb6735d7e60a5f5edd6d))
- LoroTree ([#16](https://github.com/loro-dev/loro-mirror/issues/16)) ([3990702](https://github.com/loro-dev/loro-mirror/commit/399070207f8c408c4f381ac5303b6ff0dd7acfa3))
- make setState async to avoid correctness problem ([#24](https://github.com/loro-dev/loro-mirror/issues/24)) ([cc234c3](https://github.com/loro-dev/loro-mirror/commit/cc234c3a1648704b5b44427e0728514cb7fa4832))
- state update tagging, default container inferring, fix: container initialization, misc ([#6](https://github.com/loro-dev/loro-mirror/issues/6)) ([ab41789](https://github.com/loro-dev/loro-mirror/commit/ab41789358b5679c1d8417da1a9597386b910ae8))

### Bug Fixes

- **core:** prevent divergence with null map values ([#18](https://github.com/loro-dev/loro-mirror/issues/18)) ([3fc3965](https://github.com/loro-dev/loro-mirror/commit/3fc3965d02851e64903aab1ff119f69111342861))
- initState shuold not override doc init state ([dc59fa8](https://github.com/loro-dev/loro-mirror/commit/dc59fa8975313afa49ebad1097a946c01b981b57))
- jotai sub ([90944c8](https://github.com/loro-dev/loro-mirror/commit/90944c8b2d399dd781fe73f1b591567e25cecd11))
- make all current tests pass ([6a500bb](https://github.com/loro-dev/loro-mirror/commit/6a500bbb1419467fe48a3067b9e7428485697e1a))
- make withCid as default behavior and rm this config ([#23](https://github.com/loro-dev/loro-mirror/issues/23)) ([b97ba42](https://github.com/loro-dev/loro-mirror/commit/b97ba4209ae0057c940927bee9c279bb1327302f))
- movable list diff issue ([84c308c](https://github.com/loro-dev/loro-mirror/commit/84c308c7392b96885d522729a18c24e09de70f36))

## 0.1.0 (2025-09-12)

### Features

- **core,react:** support draft-style setState; honor schema.Ignore; sync docs ([6cda9a2](https://github.com/loro-dev/loro-mirror/commit/6cda9a2c46b957005f13372c34f4063fc1de197a))
- **core:** add withCid ($cid) support for maps and tree node.data ([#19](https://github.com/loro-dev/loro-mirror/issues/19)) ([b031b09](https://github.com/loro-dev/loro-mirror/commit/b031b096ecb4c4db54529bfd2a9b04c49ba9b0c0))
- jotai binding ([#13](https://github.com/loro-dev/loro-mirror/issues/13)) ([5a381ab](https://github.com/loro-dev/loro-mirror/commit/5a381abd96e2c77f7f56bb6735d7e60a5f5edd6d))
- LoroTree ([#16](https://github.com/loro-dev/loro-mirror/issues/16)) ([3990702](https://github.com/loro-dev/loro-mirror/commit/399070207f8c408c4f381ac5303b6ff0dd7acfa3))
- make setState async to avoid correctness problem ([#24](https://github.com/loro-dev/loro-mirror/issues/24)) ([cc234c3](https://github.com/loro-dev/loro-mirror/commit/cc234c3a1648704b5b44427e0728514cb7fa4832))
- state update tagging, default container inferring, fix: container initialization, misc ([#6](https://github.com/loro-dev/loro-mirror/issues/6)) ([ab41789](https://github.com/loro-dev/loro-mirror/commit/ab41789358b5679c1d8417da1a9597386b910ae8))

### Bug Fixes

- **core:** prevent divergence with null map values ([#18](https://github.com/loro-dev/loro-mirror/issues/18)) ([3fc3965](https://github.com/loro-dev/loro-mirror/commit/3fc3965d02851e64903aab1ff119f69111342861))
- initState shuold not override doc init state ([dc59fa8](https://github.com/loro-dev/loro-mirror/commit/dc59fa8975313afa49ebad1097a946c01b981b57))
- jotai sub ([90944c8](https://github.com/loro-dev/loro-mirror/commit/90944c8b2d399dd781fe73f1b591567e25cecd11))
- make all current tests pass ([6a500bb](https://github.com/loro-dev/loro-mirror/commit/6a500bbb1419467fe48a3067b9e7428485697e1a))
- make withCid as default behavior and rm this config ([#23](https://github.com/loro-dev/loro-mirror/issues/23)) ([b97ba42](https://github.com/loro-dev/loro-mirror/commit/b97ba4209ae0057c940927bee9c279bb1327302f))
- movable list diff issue ([84c308c](https://github.com/loro-dev/loro-mirror/commit/84c308c7392b96885d522729a18c24e09de70f36))
