# Changelog

## [0.1.0](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-v0.1.0...loro-mirror-v0.1.0) (2025-09-12)


### Features

* add catchall for LoroMap ([#11](https://github.com/loro-dev/loro-mirror/issues/11)) ([8cb7d13](https://github.com/loro-dev/loro-mirror/commit/8cb7d1312d5619f4c7a32c253d5686a57494ffde))
* add support for MovableList ([0684e93](https://github.com/loro-dev/loro-mirror/commit/0684e933bf949de12b86060ce45a707f39b6ba6c))
* clean thing up, use new diff impl ([e15eab3](https://github.com/loro-dev/loro-mirror/commit/e15eab3ce65395fd0269eb682ecacbdeec8ca9f4))
* **core,react:** support draft-style setState; honor schema.Ignore; sync docs ([6cda9a2](https://github.com/loro-dev/loro-mirror/commit/6cda9a2c46b957005f13372c34f4063fc1de197a))
* **core:** add withCid ($cid) support for maps and tree node.data ([#19](https://github.com/loro-dev/loro-mirror/issues/19)) ([b031b09](https://github.com/loro-dev/loro-mirror/commit/b031b096ecb4c4db54529bfd2a9b04c49ba9b0c0))
* **core:** MovableList, Text Container fixes, Diff Improvements ([e7b4622](https://github.com/loro-dev/loro-mirror/commit/e7b46228ef55f780c32d239b585546d653624040))
* **core:** MovableList, Text Container fixes, Diff Improvements ([e7b4622](https://github.com/loro-dev/loro-mirror/commit/e7b46228ef55f780c32d239b585546d653624040))
* default required is true, add custom string type ([0e06194](https://github.com/loro-dev/loro-mirror/commit/0e06194278e1ac8b3c12b1dbf10148a8ffb2d67f))
* default required is true, add custom string type ([4d49bcd](https://github.com/loro-dev/loro-mirror/commit/4d49bcdd2f1d1140fd254652897866701c6a3846))
* LoroTree ([#16](https://github.com/loro-dev/loro-mirror/issues/16)) ([3990702](https://github.com/loro-dev/loro-mirror/commit/399070207f8c408c4f381ac5303b6ff0dd7acfa3))
* make setState async to avoid correctness problem ([#24](https://github.com/loro-dev/loro-mirror/issues/24)) ([cc234c3](https://github.com/loro-dev/loro-mirror/commit/cc234c3a1648704b5b44427e0728514cb7fa4832))
* move implementation to use virtual movable list ([8f44d64](https://github.com/loro-dev/loro-mirror/commit/8f44d6422f35c5a0eafd24d2a0598b4650d2dc85))
* refactor better movableListDiff ([dc654f9](https://github.com/loro-dev/loro-mirror/commit/dc654f9915c3b21c7d3ab3513c1d87e02b7e4628))
* state update tagging, default container inferring, fix: container initialization, misc ([#6](https://github.com/loro-dev/loro-mirror/issues/6)) ([ab41789](https://github.com/loro-dev/loro-mirror/commit/ab41789358b5679c1d8417da1a9597386b910ae8))
* support set and set-container op for MovableList ([cce36e8](https://github.com/loro-dev/loro-mirror/commit/cce36e8b094b26d3be27377811546499424031ae))


### Bug Fixes

* a few potential errors ([5784d31](https://github.com/loro-dev/loro-mirror/commit/5784d31ee4f31aa09062b779e35cf6ec25205b74))
* better list diff ([f3d01c6](https://github.com/loro-dev/loro-mirror/commit/f3d01c66fd831468d460e8f983735e0190b4c2de))
* container schema changes on update diff ([de6d18c](https://github.com/loro-dev/loro-mirror/commit/de6d18c1228d3c4003e131786f9f76a252513055))
* **core:** avoid writes on initState and normalize shape ([#20](https://github.com/loro-dev/loro-mirror/issues/20)) ([99bc365](https://github.com/loro-dev/loro-mirror/commit/99bc365d0352a2e1ae51ce90da6196ad0edff07b))
* **core:** make MovableList diff robust and support primitive items ([54c296a](https://github.com/loro-dev/loro-mirror/commit/54c296af3a393c7f1e5a91f1b437e42f41d085eb))
* **core:** prevent divergence with null map values ([#18](https://github.com/loro-dev/loro-mirror/issues/18)) ([3fc3965](https://github.com/loro-dev/loro-mirror/commit/3fc3965d02851e64903aab1ff119f69111342861))
* **core:** prevent spurious changes for unchanged ""/null in maps ([2b48f76](https://github.com/loro-dev/loro-mirror/commit/2b48f76a0281d9132c88c79d4053113490c5c5b1))
* diffing text containers inside maps ([8298d29](https://github.com/loro-dev/loro-mirror/commit/8298d298290193825ac26e9a1a2ea2409489fcee))
* duplicate notifications, list deletion with id-selector ([#4](https://github.com/loro-dev/loro-mirror/issues/4)) ([e4a287e](https://github.com/loro-dev/loro-mirror/commit/e4a287e65af6065de68acea505d660f66a63c0db))
* handle child container creation correctly ([f528f42](https://github.com/loro-dev/loro-mirror/commit/f528f42d1fd3de37ebf740dba5ad4857eb9bcfda))
* initState shuold not override doc init state ([dc59fa8](https://github.com/loro-dev/loro-mirror/commit/dc59fa8975313afa49ebad1097a946c01b981b57))
* jotai sub ([90944c8](https://github.com/loro-dev/loro-mirror/commit/90944c8b2d399dd781fe73f1b591567e25cecd11))
* list update ([14ab4ec](https://github.com/loro-dev/loro-mirror/commit/14ab4ecdfae5e0835b0036939441ecfc57e9e73b))
* make all current tests pass ([6a500bb](https://github.com/loro-dev/loro-mirror/commit/6a500bbb1419467fe48a3067b9e7428485697e1a))
* make schemaless case work ([27361f8](https://github.com/loro-dev/loro-mirror/commit/27361f8222f0f813a12ff42f8889ff4140e8a9b4))
* make withCid as default behavior and rm this config ([#23](https://github.com/loro-dev/loro-mirror/issues/23)) ([b97ba42](https://github.com/loro-dev/loro-mirror/commit/b97ba4209ae0057c940927bee9c279bb1327302f))
* **mirror:** properly initializing and updating text containers ([ee1cf29](https://github.com/loro-dev/loro-mirror/commit/ee1cf294ee8ea5532e66a3421aa1af979f0d950d))
* movable list diff issue ([84c308c](https://github.com/loro-dev/loro-mirror/commit/84c308c7392b96885d522729a18c24e09de70f36))
* proper container initialization from schema ([#1](https://github.com/loro-dev/loro-mirror/issues/1)) ([d1f7e65](https://github.com/loro-dev/loro-mirror/commit/d1f7e65e458908f908b02419c856590f11850780))
* recursive schema definition ([#2](https://github.com/loro-dev/loro-mirror/issues/2)) ([16a1c7a](https://github.com/loro-dev/loro-mirror/commit/16a1c7a3cb70d6a0950017b376b255ef334e0b2c))
* refine impl of loro list diff and apply ([2275914](https://github.com/loro-dev/loro-mirror/commit/2275914ed551a8fef3bca56e3b60819914ec2fe7))

## [0.1.0](https://github.com/loro-dev/loro-mirror/compare/loro-mirror-v0.1.0...loro-mirror-v0.1.0) (2025-09-12)


### Features

* add catchall for LoroMap ([#11](https://github.com/loro-dev/loro-mirror/issues/11)) ([8cb7d13](https://github.com/loro-dev/loro-mirror/commit/8cb7d1312d5619f4c7a32c253d5686a57494ffde))
* add support for MovableList ([0684e93](https://github.com/loro-dev/loro-mirror/commit/0684e933bf949de12b86060ce45a707f39b6ba6c))
* clean thing up, use new diff impl ([e15eab3](https://github.com/loro-dev/loro-mirror/commit/e15eab3ce65395fd0269eb682ecacbdeec8ca9f4))
* **core,react:** support draft-style setState; honor schema.Ignore; sync docs ([6cda9a2](https://github.com/loro-dev/loro-mirror/commit/6cda9a2c46b957005f13372c34f4063fc1de197a))
* **core:** add withCid ($cid) support for maps and tree node.data ([#19](https://github.com/loro-dev/loro-mirror/issues/19)) ([b031b09](https://github.com/loro-dev/loro-mirror/commit/b031b096ecb4c4db54529bfd2a9b04c49ba9b0c0))
* **core:** MovableList, Text Container fixes, Diff Improvements ([e7b4622](https://github.com/loro-dev/loro-mirror/commit/e7b46228ef55f780c32d239b585546d653624040))
* **core:** MovableList, Text Container fixes, Diff Improvements ([e7b4622](https://github.com/loro-dev/loro-mirror/commit/e7b46228ef55f780c32d239b585546d653624040))
* default required is true, add custom string type ([0e06194](https://github.com/loro-dev/loro-mirror/commit/0e06194278e1ac8b3c12b1dbf10148a8ffb2d67f))
* default required is true, add custom string type ([4d49bcd](https://github.com/loro-dev/loro-mirror/commit/4d49bcdd2f1d1140fd254652897866701c6a3846))
* LoroTree ([#16](https://github.com/loro-dev/loro-mirror/issues/16)) ([3990702](https://github.com/loro-dev/loro-mirror/commit/399070207f8c408c4f381ac5303b6ff0dd7acfa3))
* make setState async to avoid correctness problem ([#24](https://github.com/loro-dev/loro-mirror/issues/24)) ([cc234c3](https://github.com/loro-dev/loro-mirror/commit/cc234c3a1648704b5b44427e0728514cb7fa4832))
* move implementation to use virtual movable list ([8f44d64](https://github.com/loro-dev/loro-mirror/commit/8f44d6422f35c5a0eafd24d2a0598b4650d2dc85))
* refactor better movableListDiff ([dc654f9](https://github.com/loro-dev/loro-mirror/commit/dc654f9915c3b21c7d3ab3513c1d87e02b7e4628))
* state update tagging, default container inferring, fix: container initialization, misc ([#6](https://github.com/loro-dev/loro-mirror/issues/6)) ([ab41789](https://github.com/loro-dev/loro-mirror/commit/ab41789358b5679c1d8417da1a9597386b910ae8))
* support set and set-container op for MovableList ([cce36e8](https://github.com/loro-dev/loro-mirror/commit/cce36e8b094b26d3be27377811546499424031ae))


### Bug Fixes

* a few potential errors ([5784d31](https://github.com/loro-dev/loro-mirror/commit/5784d31ee4f31aa09062b779e35cf6ec25205b74))
* better list diff ([f3d01c6](https://github.com/loro-dev/loro-mirror/commit/f3d01c66fd831468d460e8f983735e0190b4c2de))
* container schema changes on update diff ([de6d18c](https://github.com/loro-dev/loro-mirror/commit/de6d18c1228d3c4003e131786f9f76a252513055))
* **core:** avoid writes on initState and normalize shape ([#20](https://github.com/loro-dev/loro-mirror/issues/20)) ([99bc365](https://github.com/loro-dev/loro-mirror/commit/99bc365d0352a2e1ae51ce90da6196ad0edff07b))
* **core:** make MovableList diff robust and support primitive items ([54c296a](https://github.com/loro-dev/loro-mirror/commit/54c296af3a393c7f1e5a91f1b437e42f41d085eb))
* **core:** prevent divergence with null map values ([#18](https://github.com/loro-dev/loro-mirror/issues/18)) ([3fc3965](https://github.com/loro-dev/loro-mirror/commit/3fc3965d02851e64903aab1ff119f69111342861))
* **core:** prevent spurious changes for unchanged ""/null in maps ([2b48f76](https://github.com/loro-dev/loro-mirror/commit/2b48f76a0281d9132c88c79d4053113490c5c5b1))
* diffing text containers inside maps ([8298d29](https://github.com/loro-dev/loro-mirror/commit/8298d298290193825ac26e9a1a2ea2409489fcee))
* duplicate notifications, list deletion with id-selector ([#4](https://github.com/loro-dev/loro-mirror/issues/4)) ([e4a287e](https://github.com/loro-dev/loro-mirror/commit/e4a287e65af6065de68acea505d660f66a63c0db))
* handle child container creation correctly ([f528f42](https://github.com/loro-dev/loro-mirror/commit/f528f42d1fd3de37ebf740dba5ad4857eb9bcfda))
* initState shuold not override doc init state ([dc59fa8](https://github.com/loro-dev/loro-mirror/commit/dc59fa8975313afa49ebad1097a946c01b981b57))
* jotai sub ([90944c8](https://github.com/loro-dev/loro-mirror/commit/90944c8b2d399dd781fe73f1b591567e25cecd11))
* list update ([14ab4ec](https://github.com/loro-dev/loro-mirror/commit/14ab4ecdfae5e0835b0036939441ecfc57e9e73b))
* make all current tests pass ([6a500bb](https://github.com/loro-dev/loro-mirror/commit/6a500bbb1419467fe48a3067b9e7428485697e1a))
* make schemaless case work ([27361f8](https://github.com/loro-dev/loro-mirror/commit/27361f8222f0f813a12ff42f8889ff4140e8a9b4))
* make withCid as default behavior and rm this config ([#23](https://github.com/loro-dev/loro-mirror/issues/23)) ([b97ba42](https://github.com/loro-dev/loro-mirror/commit/b97ba4209ae0057c940927bee9c279bb1327302f))
* **mirror:** properly initializing and updating text containers ([ee1cf29](https://github.com/loro-dev/loro-mirror/commit/ee1cf294ee8ea5532e66a3421aa1af979f0d950d))
* movable list diff issue ([84c308c](https://github.com/loro-dev/loro-mirror/commit/84c308c7392b96885d522729a18c24e09de70f36))
* proper container initialization from schema ([#1](https://github.com/loro-dev/loro-mirror/issues/1)) ([d1f7e65](https://github.com/loro-dev/loro-mirror/commit/d1f7e65e458908f908b02419c856590f11850780))
* recursive schema definition ([#2](https://github.com/loro-dev/loro-mirror/issues/2)) ([16a1c7a](https://github.com/loro-dev/loro-mirror/commit/16a1c7a3cb70d6a0950017b376b255ef334e0b2c))
* refine impl of loro list diff and apply ([2275914](https://github.com/loro-dev/loro-mirror/commit/2275914ed551a8fef3bca56e3b60819914ec2fe7))

## 0.1.0 (2025-09-12)


### Features

* add catchall for LoroMap ([#11](https://github.com/loro-dev/loro-mirror/issues/11)) ([8cb7d13](https://github.com/loro-dev/loro-mirror/commit/8cb7d1312d5619f4c7a32c253d5686a57494ffde))
* add support for MovableList ([0684e93](https://github.com/loro-dev/loro-mirror/commit/0684e933bf949de12b86060ce45a707f39b6ba6c))
* clean thing up, use new diff impl ([e15eab3](https://github.com/loro-dev/loro-mirror/commit/e15eab3ce65395fd0269eb682ecacbdeec8ca9f4))
* **core,react:** support draft-style setState; honor schema.Ignore; sync docs ([6cda9a2](https://github.com/loro-dev/loro-mirror/commit/6cda9a2c46b957005f13372c34f4063fc1de197a))
* **core:** add withCid ($cid) support for maps and tree node.data ([#19](https://github.com/loro-dev/loro-mirror/issues/19)) ([b031b09](https://github.com/loro-dev/loro-mirror/commit/b031b096ecb4c4db54529bfd2a9b04c49ba9b0c0))
* **core:** MovableList, Text Container fixes, Diff Improvements ([e7b4622](https://github.com/loro-dev/loro-mirror/commit/e7b46228ef55f780c32d239b585546d653624040))
* **core:** MovableList, Text Container fixes, Diff Improvements ([e7b4622](https://github.com/loro-dev/loro-mirror/commit/e7b46228ef55f780c32d239b585546d653624040))
* default required is true, add custom string type ([4d49bcd](https://github.com/loro-dev/loro-mirror/commit/4d49bcdd2f1d1140fd254652897866701c6a3846))
* LoroTree ([#16](https://github.com/loro-dev/loro-mirror/issues/16)) ([3990702](https://github.com/loro-dev/loro-mirror/commit/399070207f8c408c4f381ac5303b6ff0dd7acfa3))
* make setState async to avoid correctness problem ([#24](https://github.com/loro-dev/loro-mirror/issues/24)) ([cc234c3](https://github.com/loro-dev/loro-mirror/commit/cc234c3a1648704b5b44427e0728514cb7fa4832))
* move implementation to use virtual movable list ([8f44d64](https://github.com/loro-dev/loro-mirror/commit/8f44d6422f35c5a0eafd24d2a0598b4650d2dc85))
* refactor better movableListDiff ([dc654f9](https://github.com/loro-dev/loro-mirror/commit/dc654f9915c3b21c7d3ab3513c1d87e02b7e4628))
* state update tagging, default container inferring, fix: container initialization, misc ([#6](https://github.com/loro-dev/loro-mirror/issues/6)) ([ab41789](https://github.com/loro-dev/loro-mirror/commit/ab41789358b5679c1d8417da1a9597386b910ae8))
* support set and set-container op for MovableList ([cce36e8](https://github.com/loro-dev/loro-mirror/commit/cce36e8b094b26d3be27377811546499424031ae))


### Bug Fixes

* a few potential errors ([5784d31](https://github.com/loro-dev/loro-mirror/commit/5784d31ee4f31aa09062b779e35cf6ec25205b74))
* better list diff ([f3d01c6](https://github.com/loro-dev/loro-mirror/commit/f3d01c66fd831468d460e8f983735e0190b4c2de))
* container schema changes on update diff ([de6d18c](https://github.com/loro-dev/loro-mirror/commit/de6d18c1228d3c4003e131786f9f76a252513055))
* **core:** avoid writes on initState and normalize shape ([#20](https://github.com/loro-dev/loro-mirror/issues/20)) ([99bc365](https://github.com/loro-dev/loro-mirror/commit/99bc365d0352a2e1ae51ce90da6196ad0edff07b))
* **core:** make MovableList diff robust and support primitive items ([54c296a](https://github.com/loro-dev/loro-mirror/commit/54c296af3a393c7f1e5a91f1b437e42f41d085eb))
* **core:** prevent divergence with null map values ([#18](https://github.com/loro-dev/loro-mirror/issues/18)) ([3fc3965](https://github.com/loro-dev/loro-mirror/commit/3fc3965d02851e64903aab1ff119f69111342861))
* **core:** prevent spurious changes for unchanged ""/null in maps ([2b48f76](https://github.com/loro-dev/loro-mirror/commit/2b48f76a0281d9132c88c79d4053113490c5c5b1))
* diffing text containers inside maps ([8298d29](https://github.com/loro-dev/loro-mirror/commit/8298d298290193825ac26e9a1a2ea2409489fcee))
* duplicate notifications, list deletion with id-selector ([#4](https://github.com/loro-dev/loro-mirror/issues/4)) ([e4a287e](https://github.com/loro-dev/loro-mirror/commit/e4a287e65af6065de68acea505d660f66a63c0db))
* handle child container creation correctly ([f528f42](https://github.com/loro-dev/loro-mirror/commit/f528f42d1fd3de37ebf740dba5ad4857eb9bcfda))
* initState shuold not override doc init state ([dc59fa8](https://github.com/loro-dev/loro-mirror/commit/dc59fa8975313afa49ebad1097a946c01b981b57))
* jotai sub ([90944c8](https://github.com/loro-dev/loro-mirror/commit/90944c8b2d399dd781fe73f1b591567e25cecd11))
* list update ([14ab4ec](https://github.com/loro-dev/loro-mirror/commit/14ab4ecdfae5e0835b0036939441ecfc57e9e73b))
* make all current tests pass ([6a500bb](https://github.com/loro-dev/loro-mirror/commit/6a500bbb1419467fe48a3067b9e7428485697e1a))
* make schemaless case work ([27361f8](https://github.com/loro-dev/loro-mirror/commit/27361f8222f0f813a12ff42f8889ff4140e8a9b4))
* make withCid as default behavior and rm this config ([#23](https://github.com/loro-dev/loro-mirror/issues/23)) ([b97ba42](https://github.com/loro-dev/loro-mirror/commit/b97ba4209ae0057c940927bee9c279bb1327302f))
* **mirror:** properly initializing and updating text containers ([ee1cf29](https://github.com/loro-dev/loro-mirror/commit/ee1cf294ee8ea5532e66a3421aa1af979f0d950d))
* movable list diff issue ([84c308c](https://github.com/loro-dev/loro-mirror/commit/84c308c7392b96885d522729a18c24e09de70f36))
* proper container initialization from schema ([#1](https://github.com/loro-dev/loro-mirror/issues/1)) ([d1f7e65](https://github.com/loro-dev/loro-mirror/commit/d1f7e65e458908f908b02419c856590f11850780))
* recursive schema definition ([#2](https://github.com/loro-dev/loro-mirror/issues/2)) ([16a1c7a](https://github.com/loro-dev/loro-mirror/commit/16a1c7a3cb70d6a0950017b376b255ef334e0b2c))
* refine impl of loro list diff and apply ([2275914](https://github.com/loro-dev/loro-mirror/commit/2275914ed551a8fef3bca56e3b60819914ec2fe7))
