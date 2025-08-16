# CyberSurvivor Copilot Guide

## Game Context
- HTML5 Canvas + TypeScript, ES2020 target.
- Game loop = fixed timestep (16.67 ms) inside requestAnimationFrame.
- ECS-style entities; no DOM manipulation inside gameplay.

## Coding Standards
- camelCase for vars, PascalCase for classes, kebab-case filenames.
- Prefix booleans with is/has/should.
- Prefer pure functions; side effects only in Systems.
- No `console.log` in production builds; use Logger.debug/info.

## Performance Guardrails
- All new arrays preallocated where size is predictable.
- Iterate with classic `for` loops in hot paths.
- Reuse Vector2 objects; avoid object literals in inner loops.

## Commit Messages
Use imperative tense, group prefix, optional emoji.  
Example: `feat(weapon): add Railgun beam charging mechanic ⚡`

## Prompt Template
```
"You are an expert TS game dev. Improve the following system respecting project conventions.
<<FILE_SNIPPET>>
Tasks:

1. Explain the change.
2. Apply micro-optimizations.
3. Add JSDoc comments.
Respond with diff-ready code."
```
