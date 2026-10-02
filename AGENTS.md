# DSH Bridge Development Rules

## Scope

- React Native / Expo Router single application; use `heroui-native` directly. No `packages/` wrappers, shadcn, copied company patches or upstream edits.
- Use the latest compatible HeroUI Native stack. Resolve native versions through the current Expo SDK and HeroUI peer constraints, not the reference application's dependency versions.
- Use `react-native-drawer-layout` for the right, slide-type drawer. Do not replace it with a custom PanResponder or animated drawer.
- Android APK is the release target. iOS distribution remains TODO.
- Never inspect `archive/`. Temporary experiments belong in `.temp/`.

## Architecture

- Connection state has one authority: `src/store/modules/connection`. All state changes use store actions; consumers subscribe with `useStore`.
- Store-only I/O, persistence and discovery orchestration belong beside the store. Pure shared protocol rules belong in `src/utils`; native shared lifecycle hooks belong in `src/hooks`; stateful connection/WebView views belong in `src/ui` or their route. Generic visual primitives belong in `src/components`.
- Inline single-consumer wrappers. Delete obsolete code rather than retaining compatibility stubs.
- Hydrate public metadata and secure tokens before subscribing to persistence or starting automatic discovery.
- Authentication tokens must never enter AsyncStorage, logs, notification metadata or docs. Use SecureStore; keep password authentication in WebView so its cookie jar owns the session.
- Validate message type, canonical origin, document source and per-WebView nonce at the IPC boundary. External top-level URLs open outside the trusted WebView.

## UI and Effects

- Use semantic HeroUI tokens. Desktop neutrals are the source for light/dark theme mapping; the whale artwork stays black on a white tile.
- React Compiler is enabled. Do not use `useMemo` or `useCallback`.
- Named functions use `function` declarations. Arrow functions are for callbacks.
- JSX conditional rendering uses `If`, `Then`, `Else`; no ternary or `&&` conditional elements.
- Native external-resource setup/cleanup may use an effect only with `// keep:effect <reason>`. Avoid other comments unless an otherwise unclear compatibility decision needs its reason recorded.
- Do not create multiple notification subscriptions or duplicate user-facing error prompts.

## Validation

- Tests call real production functions. Mock only native/network boundaries; use fake timers and synthetic data, never user configuration.
- Explicitly import Vitest APIs. Each file cleans up its own mocks, timers, globals and subscriptions.
- No snapshots, skipped/focused tests, Jest APIs or blind delay waits. Expected values must have an independent source.
- Before delivery: typecheck, lint with zero warnings, full tests at least five independent times, shuffled tests, mutation samples, Expo native compatibility check, Android export and Android prebuild.
- Bundle/prebuild success is not proof of a native APK build or device behavior. Report those separately.
- Release signing accepts either all four secrets or none; partial signing configuration fails. Debug-signed builds must be clearly marked as evaluation prereleases.
- Do not push, tag, publish releases or download a new Android SDK without user approval.
