---
title: Tidepool, a specsite fixture
description: An invented project whose Markdown specs are published by specsite.
---

Tidepool does not exist. Its [specification](spec/), [plan](plan/), [overview](overview/) and
amendments are invented, and live as Markdown at the root of this example project. specsite publishes
them here at build time: nothing is copied into `src/content/docs`.

Try a link between documents: the plan's `F-001` row links each requirement it covers into the
specification's section page, and `REQ-KV-9`, mentioned in the plan, is reported as a build warning
because nothing defines it.
