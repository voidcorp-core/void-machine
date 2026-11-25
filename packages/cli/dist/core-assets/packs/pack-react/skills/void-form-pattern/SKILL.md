---
name: void-form-pattern
description: "Build forms with react-hook-form + Zod resolver (void-machine default): validation, error UX, submit flow with Server Actions. Composes with server-action."
---

# form-pattern

Use when building any form with > 1 field, any field with validation, or any submit that triggers a mutation. The default in void-machine is **react-hook-form** + **Zod resolver** for client-side controlled forms, paired with **Server Actions** on submit.

For a single-field action (search input, toggle, "delete" button), use a Server Action directly — no library needed.

## The default stack

- `react-hook-form` — form state, registration, validation orchestration
- `@hookform/resolvers/zod` — bridge to Zod
- `zod` — schema (single source of truth: same schema validates client AND server)
- Server Action (`void-server-action`) — the submit target

## Canonical skeleton

```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { saveContact } from '@/actions/contact';

const FormSchema = z.object({
  email: z.string().email('Format email invalide'),
  message: z.string().min(10, 'Min 10 caractères').max(2000),
});
type FormValues = z.infer<typeof FormSchema>;

export function ContactForm() {
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { email: '', message: '' },
  });

  async function onSubmit(values: FormValues) {
    const result = await saveContact(values);
    if (!result.ok) {
      form.setError('root', { message: result.error });
      return;
    }
    form.reset();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <label>
        Email
        <input {...form.register('email')} type="email" aria-invalid={!!form.formState.errors.email} />
        {form.formState.errors.email && <span role="alert">{form.formState.errors.email.message}</span>}
      </label>

      <label>
        Message
        <textarea {...form.register('message')} aria-invalid={!!form.formState.errors.message} />
        {form.formState.errors.message && <span role="alert">{form.formState.errors.message.message}</span>}
      </label>

      {form.formState.errors.root && <p role="alert">{form.formState.errors.root.message}</p>}

      <button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? 'Envoi…' : 'Envoyer'}
      </button>
    </form>
  );
}
```

Five things to notice:

1. **One Zod schema** — same schema is imported by the Server Action for server-side validation. No drift.
2. **`noValidate`** — disable browser default validation (which conflicts with custom error UX).
3. **`role="alert"`** on errors — announces to screen readers immediately.
4. **`aria-invalid`** — semantic state for AT.
5. **`form.formState.isSubmitting`** disables the button — no double-submit, no manual `useState` for loading.

## Schema sharing with the Server Action

```ts
// schemas/contact.ts (single source of truth)
import { z } from 'zod';
export const ContactSchema = z.object({
  email: z.string().email(),
  message: z.string().min(10).max(2000),
});

// app/(actions)/contact.ts
'use server';
import { ContactSchema } from '@/schemas/contact';

export async function saveContact(input: unknown) {
  const parsed = ContactSchema.safeParse(input);  // ← same schema
  if (!parsed.success) return { ok: false, error: 'invalid-input' };
  /* ... service call ... */
  return { ok: true };
}

// components/ContactForm.tsx
import { ContactSchema } from '@/schemas/contact';
// resolver: zodResolver(ContactSchema)  ← same schema
```

Never duplicate the schema in the client and server. Always import from one location.

## Error display patterns

- **Field-level errors**: render right after the input (`{errors.field && <span role="alert">`).
- **Form-level errors** (server rejection): use `form.setError('root', ...)` and render once at top or near submit button.
- **No `alert()`**, no `toast.error()` for validation — inline is more usable and accessible.
- **Focus the first invalid field on submit fail** — react-hook-form does this by default via `shouldFocusError: true`.

## When NOT to use react-hook-form

- **Single-field form** (search, newsletter signup):

  ```tsx
  <form action={subscribe}>
    <input name="email" type="email" required />
    <button>Subscribe</button>
  </form>
  ```

  Native HTML + Server Action. No library. The browser's `required` + `type="email"` covers basic validation; the Server Action does the real check.

- **File upload only** — use `<input type="file">` + Server Action; the form library adds no value.

> **Repeatable fields in a native form**: when the Server Action reads `FormData` directly (the paths above — multi-select, a checkbox group, `<input multiple>`), do **not** `Object.fromEntries(formData)`: it keeps only the last value and silently drops the rest. Read repeatable fields with `formData.getAll(name)` and validate them with `z.array(...)` in the shared schema. See `void-server-action`.

- **Wizard / multi-step** — react-hook-form's `Controller` works but consider XState or a similar state machine for complex flows.

## Anti-patterns

- ✗ **`useState` for each field** — that's what react-hook-form replaces; you lose validation, focus management, submit orchestration
- ✗ **Validation in `onSubmit` only** — users want feedback on blur, not just on submit. Use `mode: 'onBlur'` or `'onTouched'`
- ✗ **Different schemas client and server** — they drift; bugs slip through. One Zod schema.
- ✗ **Disabling submit button via `disabled={!form.formState.isValid}`** — confusing UX. Let the user click; show errors after.
- ✗ **`onSubmit={handler}` directly** — bypasses validation. Always `form.handleSubmit(handler)`.
- ✗ **Calling `toast.error()` for field validation** — inline errors are the standard a11y pattern.

## Touch + mobile

- Use `inputMode="email"` / `inputMode="numeric"` / `inputMode="decimal"` to surface the right mobile keyboard.
- `autoComplete="email"` / `"current-password"` / `"one-time-code"` for the right autofill behavior. Skip = bad UX.
- Touch targets ≥ 44×44 (composes with `void-accessibility-check`).

## Composition

- `void-server-action` — the submit target; shares the Zod schema.
- `void-security-guidance` — Zod schema is the trust boundary; server-side re-validates identically.
- `void-state-architecture` — form state IS local state; lives in the form component, never lifted.
- `void-accessibility-check` — labels, role="alert", focus management on error.
- `void-tdd` — form components get `@testing-library/user-event` tests asserting validation + submit + error display.
