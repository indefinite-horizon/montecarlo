# Frontend Performance

The web app uses React Compiler, but component boundaries and subscription
shape still matter.

## Stable Props

Prefer primitive props over objects and arrays. Stable props let React Compiler
and memoized components skip work.

```tsx
// Prefer this
<ProfilePanel userId={user._id} />

// Avoid this when the child can query by ID
<ProfilePanel user={user} />
```

Hoist default arrays and objects to module constants instead of creating them
inside parameter destructuring.

## Render Rules

- Compute derived state during render or with `useMemo`; do not mirror it with `useEffect`.
- Use functional `setState` to keep callbacks stable.
- Store transient values such as scroll position, timers, and hover coordinates in refs.
- Put interaction work in event handlers instead of effects when possible.
- Avoid inline arrow functions in hot JSX lists.

## Convex Query Isolation

Each `useQuery` creates a live subscription and re-renders its host component
when data changes.

- Put `useQuery` in the smallest component that needs the data.
- Pass IDs down and let children subscribe directly when that reduces parent churn.
- Use `"skip"` for queries that are not always needed.
- Avoid broad parent queries that feed many unrelated children.

## Lazy Loading

Use `React.lazy` for heavy dialogs, settings panels, charts, editors, and other
surfaces that are not needed for the first paint.

```tsx
const SettingsDialog = React.lazy(() => import("./SettingsDialog"));
```

Wrap lazy dialogs with `Suspense` and prefer `null` fallback for modal content
to avoid layout shifts.

## Lists

Use virtualization for lists that can grow past roughly 50 visible rows. Avoid
rendering hidden rows just because the initial dataset is small.

## Analytics

The browser analytics provider lazy-loads PostHog. Do not import analytics SDKs
on route or component hot paths.

## Review Checklist

- Did a parent start subscribing to data only a child needs?
- Did a component receive new object or array props each render?
- Did an effect get added for work that belongs in an event handler?
- Did a new route pull a large dependency into the initial bundle?
- Did a loading state shift layout?
