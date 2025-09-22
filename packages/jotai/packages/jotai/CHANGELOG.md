# Changelog

## [1.0.0](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-jotai-v0.2.0...loro-mirror-jotai-v1.0.0) (2025-09-22)


### ⚠ BREAKING CHANGES

* make events synchronous by using loro-crdt@1.8.0 ([#39](https://github.com/loro-dev/loro-mirror/issues/39))

### Features

* make events synchronous by using loro-crdt@1.8.0 ([#39](https://github.com/loro-dev/loro-mirror/issues/39)) ([27aa95b](https://github.com/loro-dev/loro-mirror/commit/27aa95ba135e56ee3e3f56fb7f1a18cf448938f7))


### Bug Fixes

* **jotai:** only subscribe the state which is from loro ([#34](https://github.com/loro-dev/loro-mirror/issues/34)) ([9817678](https://github.com/loro-dev/loro-mirror/commit/981767892b1e5c0198e431eefe80d82d0033f4bf))

## [0.2.0](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-jotai-v0.1.1...loro-mirror-jotai-v0.2.0) (2025-09-17)


### Features

* **core:** add withCid ($cid) support for maps and tree node.data ([#19](https://github.com/loro-dev/loro-mirror/issues/19)) ([b031b09](https://github.com/loro-dev/loro-mirror/commit/b031b096ecb4c4db54529bfd2a9b04c49ba9b0c0))
* jotai binding ([#13](https://github.com/loro-dev/loro-mirror/issues/13)) ([5a381ab](https://github.com/loro-dev/loro-mirror/commit/5a381abd96e2c77f7f56bb6735d7e60a5f5edd6d))
* make setState async to avoid correctness problem ([#24](https://github.com/loro-dev/loro-mirror/issues/24)) ([cc234c3](https://github.com/loro-dev/loro-mirror/commit/cc234c3a1648704b5b44427e0728514cb7fa4832))


### Bug Fixes

* **core:** avoid writes on initState and normalize shape ([#20](https://github.com/loro-dev/loro-mirror/issues/20)) ([99bc365](https://github.com/loro-dev/loro-mirror/commit/99bc365d0352a2e1ae51ce90da6196ad0edff07b))
* **core:** prevent divergence with null map values ([#18](https://github.com/loro-dev/loro-mirror/issues/18)) ([3fc3965](https://github.com/loro-dev/loro-mirror/commit/3fc3965d02851e64903aab1ff119f69111342861))
* initState shuold not override doc init state ([dc59fa8](https://github.com/loro-dev/loro-mirror/commit/dc59fa8975313afa49ebad1097a946c01b981b57))
* jotai init ([505e419](https://github.com/loro-dev/loro-mirror/commit/505e41966d4c1089047e3394f196fb0d53a6ce18))
* jotai sub ([90944c8](https://github.com/loro-dev/loro-mirror/commit/90944c8b2d399dd781fe73f1b591567e25cecd11))
* make withCid as default behavior and rm this config ([#23](https://github.com/loro-dev/loro-mirror/issues/23)) ([b97ba42](https://github.com/loro-dev/loro-mirror/commit/b97ba4209ae0057c940927bee9c279bb1327302f))

## [0.1.0](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-jotai-v0.1.0...loro-mirror-jotai-v0.1.0) (2025-09-12)


### Features

* **core:** add withCid ($cid) support for maps and tree node.data ([#19](https://github.com/loro-dev/loro-mirror/issues/19)) ([b031b09](https://github.com/loro-dev/loro-mirror/commit/b031b096ecb4c4db54529bfd2a9b04c49ba9b0c0))
* jotai binding ([#13](https://github.com/loro-dev/loro-mirror/issues/13)) ([5a381ab](https://github.com/loro-dev/loro-mirror/commit/5a381abd96e2c77f7f56bb6735d7e60a5f5edd6d))
* make setState async to avoid correctness problem ([#24](https://github.com/loro-dev/loro-mirror/issues/24)) ([cc234c3](https://github.com/loro-dev/loro-mirror/commit/cc234c3a1648704b5b44427e0728514cb7fa4832))


### Bug Fixes

* **core:** avoid writes on initState and normalize shape ([#20](https://github.com/loro-dev/loro-mirror/issues/20)) ([99bc365](https://github.com/loro-dev/loro-mirror/commit/99bc365d0352a2e1ae51ce90da6196ad0edff07b))
* **core:** prevent divergence with null map values ([#18](https://github.com/loro-dev/loro-mirror/issues/18)) ([3fc3965](https://github.com/loro-dev/loro-mirror/commit/3fc3965d02851e64903aab1ff119f69111342861))
* initState shuold not override doc init state ([dc59fa8](https://github.com/loro-dev/loro-mirror/commit/dc59fa8975313afa49ebad1097a946c01b981b57))
* jotai init ([505e419](https://github.com/loro-dev/loro-mirror/commit/505e41966d4c1089047e3394f196fb0d53a6ce18))
* jotai sub ([90944c8](https://github.com/loro-dev/loro-mirror/commit/90944c8b2d399dd781fe73f1b591567e25cecd11))
* make withCid as default behavior and rm this config ([#23](https://github.com/loro-dev/loro-mirror/issues/23)) ([b97ba42](https://github.com/loro-dev/loro-mirror/commit/b97ba4209ae0057c940927bee9c279bb1327302f))

## [0.1.0](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-jotai-v0.1.0...loro-mirror-jotai-v0.1.0) (2025-09-12)


### Features

* **core:** add withCid ($cid) support for maps and tree node.data ([#19](https://github.com/loro-dev/loro-mirror/issues/19)) ([b031b09](https://github.com/loro-dev/loro-mirror/commit/b031b096ecb4c4db54529bfd2a9b04c49ba9b0c0))
* jotai binding ([#13](https://github.com/loro-dev/loro-mirror/issues/13)) ([5a381ab](https://github.com/loro-dev/loro-mirror/commit/5a381abd96e2c77f7f56bb6735d7e60a5f5edd6d))
* make setState async to avoid correctness problem ([#24](https://github.com/loro-dev/loro-mirror/issues/24)) ([cc234c3](https://github.com/loro-dev/loro-mirror/commit/cc234c3a1648704b5b44427e0728514cb7fa4832))


### Bug Fixes

* **core:** avoid writes on initState and normalize shape ([#20](https://github.com/loro-dev/loro-mirror/issues/20)) ([99bc365](https://github.com/loro-dev/loro-mirror/commit/99bc365d0352a2e1ae51ce90da6196ad0edff07b))
* **core:** prevent divergence with null map values ([#18](https://github.com/loro-dev/loro-mirror/issues/18)) ([3fc3965](https://github.com/loro-dev/loro-mirror/commit/3fc3965d02851e64903aab1ff119f69111342861))
* initState shuold not override doc init state ([dc59fa8](https://github.com/loro-dev/loro-mirror/commit/dc59fa8975313afa49ebad1097a946c01b981b57))
* jotai init ([505e419](https://github.com/loro-dev/loro-mirror/commit/505e41966d4c1089047e3394f196fb0d53a6ce18))
* jotai sub ([90944c8](https://github.com/loro-dev/loro-mirror/commit/90944c8b2d399dd781fe73f1b591567e25cecd11))
* make withCid as default behavior and rm this config ([#23](https://github.com/loro-dev/loro-mirror/issues/23)) ([b97ba42](https://github.com/loro-dev/loro-mirror/commit/b97ba4209ae0057c940927bee9c279bb1327302f))

## 0.1.0 (2025-09-12)


### Features

* **core:** add withCid ($cid) support for maps and tree node.data ([#19](https://github.com/loro-dev/loro-mirror/issues/19)) ([b031b09](https://github.com/loro-dev/loro-mirror/commit/b031b096ecb4c4db54529bfd2a9b04c49ba9b0c0))
* jotai binding ([#13](https://github.com/loro-dev/loro-mirror/issues/13)) ([5a381ab](https://github.com/loro-dev/loro-mirror/commit/5a381abd96e2c77f7f56bb6735d7e60a5f5edd6d))
* make setState async to avoid correctness problem ([#24](https://github.com/loro-dev/loro-mirror/issues/24)) ([cc234c3](https://github.com/loro-dev/loro-mirror/commit/cc234c3a1648704b5b44427e0728514cb7fa4832))


### Bug Fixes

* **core:** avoid writes on initState and normalize shape ([#20](https://github.com/loro-dev/loro-mirror/issues/20)) ([99bc365](https://github.com/loro-dev/loro-mirror/commit/99bc365d0352a2e1ae51ce90da6196ad0edff07b))
* **core:** prevent divergence with null map values ([#18](https://github.com/loro-dev/loro-mirror/issues/18)) ([3fc3965](https://github.com/loro-dev/loro-mirror/commit/3fc3965d02851e64903aab1ff119f69111342861))
* initState shuold not override doc init state ([dc59fa8](https://github.com/loro-dev/loro-mirror/commit/dc59fa8975313afa49ebad1097a946c01b981b57))
* jotai init ([505e419](https://github.com/loro-dev/loro-mirror/commit/505e41966d4c1089047e3394f196fb0d53a6ce18))
* jotai sub ([90944c8](https://github.com/loro-dev/loro-mirror/commit/90944c8b2d399dd781fe73f1b591567e25cecd11))
* make withCid as default behavior and rm this config ([#23](https://github.com/loro-dev/loro-mirror/issues/23)) ([b97ba42](https://github.com/loro-dev/loro-mirror/commit/b97ba4209ae0057c940927bee9c279bb1327302f))
