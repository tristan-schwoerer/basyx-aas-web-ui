# AIMC visualization plugin

A user plugin for the AAS Web UI that renders one IDTA
`AssetInterfacesMappingConfiguration` (AIMC) route at a time, with a Lua editor
for its transformation blobs — including the DMP `ResponseTransformation`
extension.

It lives in `aas-web-ui/src/UserPlugins/`. The Web UI discovers plugins from
`./UserPlugins/**/*.vue` at **build** time (`import.meta.glob` in `main.ts`), so
a plugin is part of the source tree, not something mounted into a running
container.

## Why a route is chosen in-plugin

A route is an item of the `MappingConfigurations` `SubmodelElementList`, and
**AASd-114** makes every list item inherit the *list's* `semanticId` — so
`aas_pydantic` deliberately strips the per-item `semanticId` during
serialisation (`convert_pydantic_model.py`, "Clear individual semantic_ids
(AASd-114)"). The BaSyx UI only dispatches a plugin when the selected element
*has* a `semanticId`, so it can dispatch on the AIMC submodel but never on an
individual route.

Consequences for this plugin:

- the plugin is registered for the AIMC submodel ids
  (`.../2/0/Submodel` and `.../1/0/Submodel`), not for a route;
- opening the AIMC submodel shows an **index** of its routes; picking one draws
  that route alone. The whole submodel is never drawn as one flow;
- the AAS tree labels the routes `[0] SubmodelElementCollection`, `[1] …`,
  which is a second reason the in-plugin index is needed.

If routes should become individually addressable, the standards-compliant fix
is in the model — carry them in a `HierarchicalStructures` collection (which
admits named `idShort`s) instead of a `SubmodelElementList`. That is an
`aas-model` / registration-service change, not a UI one.

## What is drawn

Within the focused route:

- **sources on the left** as rounded rectangles, **sinks on the right** in the
  same shape;
- the **Lua transformation in the middle** (`ResponseTransformation` below it for
  bi-directional action contracts);
- **all connections are dashed splines whose dashes march along the data
  transfer**. The correlated reply of a bi-directional route is drawn as a
  separate return lane with a coarser dash, from the sink back through the
  response transformation to the source;
- each box carries **two distinct connection points** on the side the data
  crosses, so the two directions never share an attachment point: `out` (upper)
  and `in` (lower) for a source, mirrored for a sink. They are placed as a
  share of the node height so they stay apart when an endpoint is expanded.

Sources and sinks that originate in the same SMC share a labelled frame
(`interface_mqtt`, `Variables`, …), so a route that fans out over several
interfaces stays readable.

A route is **bi-directional** when it authors a `ResponseTransformation` *or*
when it is classified as an operation delegation — in the latter case the reply
defaults to a passthrough, which the UI marks accordingly.

### Interaction

- **click a source or sink** — it expands and lists the `ModelReference` keys of
  the `ReferenceElement` it points at (`Submodel` → `SubmodelElementCollection` →
  …);
- **click a transformation** (or its *Open editor* button) — scrolls to the Lua
  editor, switching to the response direction when the reply blob is clicked.

Node and edge ids are scoped to the route (`mapping_5-source-0`,
`mapping_5-request`, …). Vue Flow keys its registries by id, so ids shared
between routes make it re-bind an edge to the previous route's handle element,
which leaves the path only partially drawn. The graph is also committed in two
phases — nodes, then edges — so no edge is resolved against an unmeasured
handle.

## Delivery modes

The DMP has exactly **two** delivery modes (`classify_delivery` in
`aas-camel-dmp/management_node/execution_policy.py`), and the plugin mirrors
them:

| Accent | Label | Meaning |
| --- | --- | --- |
| blue | `poll Ns` | a positive `PollingInterval` is declared — the descriptor emits a `pollingIntervalMs` and the DMP samples the source on a timer |
| green | `pushed` | no polling interval — the transport delivers the value: an event affordance, a property declared `observable`, or a message topic |

A per-source `PollingInterval` wins over the route's `DefaultPollingInterval`. An
explicitly declared interval **overrides** the transport default, so a retained
MQTT topic can still be sampled.

The affordance group (`properties` / `actions` / `events`) is transport metadata
shown as its own chip per endpoint — it is *not* a third delivery mode. Sinks
carry no accent, because delivery is a property of how a value is *read*.

## Editing and saving

The editor is read-only until the pencil toggle is switched on, which requires
`ALLOW_EDITING=true` in the Web UI environment. Saving validates that an
`aimc_main(sources)` entrypoint is present, then `PUT`s the blob back to its
Submodel Repository path. A direction that has no blob in the repository (a
passthrough reply) cannot be saved and says so.

The `PUT` echoes the original element back with only `value` replaced, so
`semanticId`, `description` and any qualifiers survive — the DMP resolver
classifies `ResponseTransformation` by its semantic id, so rebuilding a bare
`Blob` would break the mapping.

## Tests

`src/UserPlugins/aimc/composables/parseAimc.test.ts` runs against the real
Submodel Repository payloads in the AP2030-UNS repository
(`aas-model/tests/data_aimc.json`,
`aas-camel-dmp/management-node/tests/data/syntegon_stoppering_aimc.json`,
`.../events/sm_created.json`). Point it at a checkout:

```bash
AIMC_FIXTURE_ROOT=/path/to/AP2030-UNS npx vitest run src/UserPlugins
```

The `Dockerfile.ci` build deletes `*.test.ts` under `UserPlugins` because the
fixtures are not part of this repository; upstream's own suite is unaffected.

## Files

```
aas-web-ui/src/UserPlugins/
├── AimcMappingConfiguration.vue   plugin entry point (semanticId dispatch)
└── aimc/
    ├── components/
    │   ├── AimcMappingGraph.vue         Vue Flow graph of one route
    │   ├── AimcTransformationEditor.vue editor card + persistence
    │   └── LuaCodeEditor.vue            Monaco with Lua registered
    ├── composables/
    │   ├── parseAimc.ts                 parseAimcRoute / parseAimc
    │   └── parseAimc.test.ts
    └── types/
        ├── index.ts                     mapping model
        └── semanticIds.ts               IDTA + DMP semantic ids
```
