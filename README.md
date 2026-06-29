# DAVA Resource Studio

DAVA Resource Studio is a Windows desktop application and Rust toolkit for inspecting and modifying World of Tanks Blitz resources. It understands the outer DVPL container, presents the game `Data` directory as a virtual filesystem, and provides text-oriented editors and research tools.

> This project is unofficial and is not affiliated with Wargaming, Lesta Games, or the DAVA Engine project.

## Features

### Desktop Studio

- Detect or manually select a Steam/Lesta game installation.
- Browse the game `Data` directory as a searchable tree.
- Transparently unpack and repack `.dvpl` resources.
- Open multiple resources in tabs with draft, staged, and applied states.
- Edit YAML, JSON, `.material`, `.sl`, and `.slh` text resources.
- Validate and explicitly format YAML/material/JSON documents.
- Inspect material layers, shaders, defines, passes, presets, and render state.
- Index shader includes, macros, conditions, uniforms, properties, and entry points.
- Navigate shader includes and search symbol references.
- Map uniforms, properties, macros, conditions, and entry points across recursive include graphs with live editor highlights and gutter navigation.
- Edit recognized runtime graphics settings with recoverable backups.
- Inspect, compare, export, back up, clear, and restore opaque shader-cache entries.
- Apply resources, invalidate the shader cache, and launch the detected game.

The Studio refuses game-file, runtime-setting, and shader-cache mutations while `wotblitz.exe` is running.

### Rust crates and CLI

| Component | Purpose |
| --- | --- |
| `crates/dvpl` | DVPL packing, unpacking, CRC validation, and basic resource classification |
| `crates/resourcefs` | Virtual filesystem with transparent DVPL reads and staged writes |
| `crates/game` | Game installation detection and validation |
| `app/dvpl-pipeline` | Recursive command-line copy, unpack, and optional repack workflow |
| `app/studio` | React + Tauri desktop application |

## Building

Requirements:

- Windows 11
- Rust stable with the MSVC toolchain
- Node.js and npm
- Tauri 2 Windows prerequisites, including Microsoft WebView2

### Desktop application

```powershell
cd dava-resource-studio\app\studio
npm install
npm run tauri dev
```

Build an installer/release bundle with:

```powershell
npm run tauri build
```

Bundles are written below `app/studio/src-tauri/target/release/bundle`.

### Rust workspace and CLI

```powershell
cd dava-resource-studio
cargo build --workspace --release
cargo test --workspace
```

The CLI binary is written to `target/release/dvpl-pipeline.exe`.

Example:

```powershell
.\target\release\dvpl-pipeline.exe --input "D:\SomePack"
```

To repack the resulting plaintext resources:

```powershell
.\target\release\dvpl-pipeline.exe --input "D:\SomePack" --encrypt-back
```

Run `dvpl-pipeline.exe --help` for directory and deletion options. Deletion flags are irreversible.

## DVPL versus the inner resource format

A filename such as:

```text
chassis_spark.sc2.dvpl
```

contains two distinct formats:

```text
DVPL container
└── SC2 payload
```

DVPL is an outer transport/storage wrapper. Unpacking DVPL validates its footer and CRC and then returns either the stored bytes or an LZ4-decompressed byte stream. It does **not** convert the inner payload into text, JSON, an image, or an editable scene.

The virtual filesystem hides only the final `.dvpl` suffix:

```text
blinn1SG_Base_Color.dx11.dds.dvpl  →  blinn1SG_Base_Color.dx11.dds
Boss_mode/Graviton.scg.dvpl       →  Boss_mode/Graviton.scg
```

The bytes remain DDS and SCG data respectively.

## Binary resources

Many of the most common Blitz resources are binary. The Studio deliberately treats unrecognized or non-UTF-8 payloads as read-only opaque data. It does not place placeholder text into an editable document, because saving that placeholder would destroy the original asset.

### `.sc2`

`.sc2` files are DAVA scene/effect assets used throughout `Data/3d`, including vehicles, maps, hangars, and visual effects. They are not “DVPL text files” after unpacking. Their internal structure is engine-specific and is not currently parsed or serialized by this project.

Current behavior:

- DVPL unpack/repack: supported.
- Byte-preserving export or replacement: possible through the underlying tooling.
- Scene graph inspection/editing: not supported.
- Text editing: intentionally disabled.

Do not rename arbitrary data to `.sc2` or edit it in a text editor. A valid replacement must already be encoded in the format expected by the game version.

### `.scg`

`.scg` files appear extensively in effects and other scene-related content. They are treated as proprietary/engine-specific graph data. The exact relationship between every SCG and SC2 variant has not been established well enough here to promise lossless parsing.

Current behavior is therefore the same as for SC2: the DVPL layer is supported, while the inner SCG payload remains opaque and read-only.

### `.dx11.dds`

Files ending in `.dx11.dds` are DDS texture payloads selected or named for the DirectX 11 asset variant. `.dx11` is part of the resource basename/variant convention; `.dds` is the actual texture container extension.

For example:

```text
tx_tracer01.dx11.dds.dvpl
```

is a DVPL-wrapped DDS texture. After unpacking, a DDS-capable image tool may be able to inspect it. Correct replacement still requires preserving the dimensions, mip chain, pixel/compression format, channel interpretation, and any engine-specific expectations. Merely converting a PNG to a file named `.dds` is not sufficient.

The Studio currently does not decode, preview, or encode DDS textures.

### Other binary formats

| Extension | Typical role | Current support |
| --- | --- | --- |
| `.pvr` | PowerVR texture container/variant | Opaque payload; DVPL only |
| `.webp`, `.png` | Image payloads | Opaque in the Studio; may be opened externally after unpacking |
| `.anim`, `.animation`, `.actions` | Animation/action data | Opaque engine data |
| `.bnk` | Audiokinetic Wwise sound bank | Opaque payload; DVPL only |
| `.pck` | Audiokinetic Wwise packaged audio/media data | Opaque payload; DVPL only |
| `.heightmap` | Terrain/height data | Opaque payload |
| `.lka`, `.mkm`, `.model` | Engine-specific asset data | Opaque payload; format not claimed |
| `.bin` | Generic binary data, including shader cache entries | Metadata/hex-header inspection only where implemented |

An extension is only a hint. The project does not assume that every file with the same suffix shares an identical version or schema.

### Wwise audio

Blitz uses Audiokinetic Wwise for audio. `.bnk` resources are Wwise sound banks containing sound structures, events, and references, while `.pck` resources are Wwise packages commonly used to bundle streamed or encoded media. They may reference additional encoded audio rather than containing directly playable PCM data.

DAVA Resource Studio currently supports only the surrounding DVPL layer. It does not parse Wwise hierarchy metadata, resolve event-to-media relationships, preview encoded audio, or rebuild sound banks/packages. After DVPL unpacking, use tooling that explicitly supports the matching Wwise bank/package version. Replacing individual media bytes without rebuilding offsets, tables, hashes, and references can corrupt the package or make events silent.

## Safe binary-resource workflow

1. Close the game before changing resources.
2. Keep the original DVPL file or a complete game backup.
3. Unpack DVPL without modifying the returned payload.
4. Inspect the inner file using a tool that explicitly supports that format and variant.
5. If replacing it, verify format, dimensions/schema, and game-version compatibility.
6. Repack the exact resulting bytes into DVPL.
7. Clear the shader cache only when the modified resource requires it; use the Studio's backup-and-clear operation.
8. Test one change at a time and restore the backup if the game crashes or rejects the resource.

Steam file verification can restore official files, but it is not a substitute for keeping backups of intentional local changes.

## Text resources

The built-in editor is intended for known text payloads:

- `.yaml` and `.yml`
- `.json`
- `.material` files that use the observed YAML-like material schema
- `.sl` and `.slh` DAVA shader sources/includes

Shader support is structural rather than a full compiler. The project can highlight and index observed syntax, but it cannot guarantee that a shader is semantically valid for the proprietary engine/compiler pipeline.

Formatting YAML/material files is explicit because serialization may change whitespace, ordering, quoting, or comments. Validation alone does not rewrite the resource.

## Staging and writes

Editing and writing are separate operations:

```text
Edit tab → Stage in memory → Apply all → Repack/write to game Data
```

`resourcefs` keeps staged bytes in memory until `flush()`/Apply All. Discarding clears staged changes without touching disk. Applying a DVPL-backed virtual path recompresses the payload and writes it back to its `.dvpl` backing file.

## Shader cache

The Windows runtime cache is normally located at:

```text
%LOCALAPPDATA%\wotblitz\DAVAProject\shader_cache
```

Cache entries are treated as opaque compiled blobs. The Studio can calculate metadata and SHA-256 hashes, show leading bytes, compare/export entries, and move the entire cache to a timestamped backup. It does not claim to decode shader permutations or map compiled entries back to source files.

“Rebuild cache” means:

```text
Apply staged resources → move cache to backup → create empty cache → launch game
```

It does not invoke a standalone shader compiler.

## Current limitations

- No SC2, SCG, DDS, PVR, model, animation, or audio editor/previewer.
- No proprietary shader compilation.
- No decoded shader-cache format or source-to-cache mapping.
- Material inspection covers the observed YAML-like schema and remains read-only.
- Windows/Steam is the primary tested environment.
- Game updates may change paths, schemas, and binary formats.

## Development checks

```powershell
cd app\studio
npm test
npm run build

cd ..\..
cargo test --workspace
```

The frontend production build may report a large-chunk warning because CodeMirror language parsers are currently bundled with the main application.
