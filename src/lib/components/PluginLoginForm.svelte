<script lang="ts">
  import type { PluginFieldSchema, PluginExecuteResult } from '../plugins/types';

  // Purely presentational - the parent decides what "submit" actually does
  // (which plugin, how the resulting configPatch gets applied to a
  // command). Keeps this reusable for any plugin's loginSchema, not just
  // TimePad's.
  export let schema: PluginFieldSchema[];
  export let onSubmit: (fields: Record<string, string>) => Promise<PluginExecuteResult>;

  let values: Record<string, string> = {};
  let submitting = false;
  let error = '';
  let success = '';

  const submit = async () => {
    submitting = true;
    error = '';
    success = '';
    try {
      const result = await onSubmit(values);
      if (result.ok) {
        success = result.message ?? 'Logged in';
        values = {};
      } else {
        error = result.message ?? 'Login failed.';
      }
    } finally {
      submitting = false;
    }
  };
</script>

<form class="login-form" on:submit|preventDefault={() => void submit()}>
  {#each schema as field (field.key)}
    <label>
      <span>{field.label}</span>
      <input
        type={field.type === 'password' ? 'password' : 'text'}
        bind:value={values[field.key]}
        placeholder={field.placeholder ?? ''}
        autocomplete="off"
        spellcheck="false"
      />
    </label>
  {/each}
  <button class="btn primary" type="submit" disabled={submitting}>{submitting ? 'Logging in…' : 'Log in'}</button>
  {#if error}<p class="error">{error}</p>{/if}
  {#if success}<p class="success">{success}</p>{/if}
</form>

<style>
  .login-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.6rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--border);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.78rem;
    color: var(--muted);
  }

  input {
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--panel-2);
    color: var(--text);
    padding: 0.4rem 0.5rem;
    font-size: 0.8rem;
  }

  input:focus {
    outline: 2px solid var(--accent-soft);
    outline-offset: 0;
  }

  .btn {
    align-self: flex-start;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--panel-2);
    color: var(--text);
    font-size: 0.78rem;
    padding: 0.4rem 0.75rem;
  }

  .btn.primary {
    background: var(--accent-soft);
    font-weight: 600;
  }

  .btn:disabled {
    opacity: 0.6;
  }

  .error {
    margin: 0;
    font-size: 0.75rem;
    color: #ef4444;
  }

  .success {
    margin: 0;
    font-size: 0.75rem;
    color: var(--accent);
  }
</style>
