---
name: todo-list-manager
description: Manage a prioritized to-do list using the todo-manager MCP server. Use this skill when the user asks to add tasks, mark tasks complete, soft-delete or list tasks, count tasks, get the current/priority task, or reorder tasks. Tasks support soft-delete (deleted flag) and status filters (all|active|completed|deleted). Read operations are exposed as BOTH tools (list_todos, count_todos, get_current_todo, get_todo_by_id) and resources (todo://list, todo://current); ALWAYS prefer the tools because many MCP clients do not expose resources to the model. State changes go through add_todo, complete_todo, move_todo_to_top, delete_todo. The list is in-memory and resets when the server restarts.
---

# todo-manager — prioritized to-do list with soft-delete

The `todo-manager` MCP server keeps an ordered, in-memory to-do list.
Each task has `id` (opaque string), `text`, `completed`, and
`deleted`. Order is meaningful: the first *active* (not completed,
not deleted) task is the "current" priority task.

## CRITICAL: tools first, resources second

This server exposes the same read data twice:

| Data              | Tool (always callable)   | Resource (client-dependent)         |
|-------------------|--------------------------|-------------------------------------|
| Full list         | `list_todos({filterStatus})` | `todo://list[?status=...]`      |
| Task count        | `count_todos`            | — (use the tool)                    |
| Current priority  | `get_current_todo`       | `todo://current`                    |
| Single task by ID | `get_todo_by_id`         | —                                   |

**Many MCP clients (including CLI agents) do NOT expose resources as
callable actions.** If you see only tools in your tool list, that is
normal — use the tools above. Do not respond "I cannot list/count
tasks" and do not ask the user for a tool that does not exist. The
read tools above ARE the list/count operations.

## Quick start

There is no mandatory `open` call — the server is always ready.
For any question about state, start with a read tool:

- count question → `count_todos()`
- "what's on my list" → `list_todos({ filterStatus: "active" })`
- "what should I do now" → `get_current_todo()`
- "status of task X" (ID known) → `get_todo_by_id({ id })`

## Key concepts

- **Soft-delete, not hard-delete.** `delete_todo` sets
  `deleted = true`. The task stays in memory and `get_todo_by_id`
  still finds it (status "Удалена"), but it is hidden from
  `list_todos({filterStatus:"all"})` and from `get_current_todo`.
- **Default list excludes deleted tasks.** `filterStatus: "all"`
  means "not deleted" (active + completed). To see deleted tasks
  you must ask explicitly: `filterStatus: "deleted"`.
- **Deleted tasks are read-only.** `complete_todo` and
  `move_todo_to_top` return an error if the task is deleted. They
  do not resurrect it. There is no `restore_todo` in the current
  build.
- **IDs are opaque strings.** `add_todo` returns something like
  `"k3j9x2"`. Always pass IDs back verbatim; never use position
  numbers for mutations.
- **Completed tasks stay visible.** `complete_todo` flips
  `completed = true`; the task remains in `list_todos` as `[X]`
  and is skipped by `get_current_todo`.
- **Status markers in `list_todos` / `todo://list` output:**
  `[ ]` active, `[X]` completed, `[D]` deleted. Deleted markers
  appear only when `filterStatus: "deleted"` is requested.
- **"Current" = first active task.** `get_current_todo` returns
  the first task with `completed == false && deleted == false`.
  If none, it returns "Нет активных задач в списке."
- **Ordering is array order.** `move_todo_to_top` splices the
  task out and `unshift`s it to index 0. `add_todo` appends to
  the end. Deleted tasks keep their array position but are
  skipped by all reads.
- **In-memory only.** The list resets when the server process
  restarts. Do not promise persistence.
- **Responses are in Russian.** Parse the returned ID from
  `add_todo` rather than the human text when you need a machine
  value.

## Read tool catalog (use these, not resources)

### `count_todos` — numbers

```json
{}
```

Returns:
`Всего (без удалённых): N. Активных: A. Выполненных: C. Удалённых (скрытых): D.`

- `Всего (без удалённых)` = active + completed, **excludes**
  deleted.
- `Удалённых (скрытых)` is reported separately so the user can
  see that soft-deleted tasks still exist in memory.
- This is the direct answer to "сколько задач", "how many tasks",
  "how many are left", "how many did I delete".

### `list_todos` — filtered list

```json
{ "filterStatus": "all" }
```

`filterStatus` is optional, default `"all"`. Allowed values:

- `"all"` — active + completed (deleted **hidden**).
- `"active"` — `completed == false && deleted == false`.
- `"completed"` — `completed == true && deleted == false`.
- `"deleted"` — `deleted == true` only.

Output, one line per task, in array order:

```
[ ] ID: 1 (Позиция: 1) - Изучить спецификацию Model Context Protocol
[X] ID: 2 (Позиция: 2) - Написать MCP-сервер для To-Do списка
[D] ID: 3 (Позиция: 3) - Новая тестовая задача
```

`Позиция` is the 1-based index **within the filtered result** —
it shifts after any reorder and differs per filter. Empty result
returns `Список задач пуст.`

**Rules of thumb:**
- Default user request ("show my list") → `"active"` or `"all"`,
  not `"deleted"`.
- "What did I delete?" → `"deleted"`.
- Never combine `filterStatus` from one call with IDs from another
  stale call; re-read before mutating.

### `get_current_todo` — priority task

```json
{}
```

Returns the first task with `completed == false && deleted == false`:

```
Текущая активная задача:
[ ] ID: <id> - <text>
```

If every task is completed or deleted: `Нет активных задач в списке.`

### `get_todo_by_id` — one task, including deleted

```json
{ "id": "k3j9x2" }
```

Returns ID, text, and status — one of `В процессе` / `Выполнена` /
`Удалена`. **This is the only read that sees deleted tasks by ID.**
Use it when the user mentions a task you suspect was deleted, or to
confirm a status without scanning the list.

Failure: `Задача с ID <id> не найдена.`

## Mutation tool catalog

### `add_todo` — create

```json
{ "text": "Buy groceries" }
```

Appends a new task with `completed=false, deleted=false` to the end.
Response: `Задача успешно добавлена. ID: <id>` — extract `<id>`.

### `complete_todo` — mark done

```json
{ "id": "k3j9x2" }
```

Sets `completed = true`. Fails if the task is deleted:
`Ошибка: Задача с ID <id> помечена как удалённая.`
Does **not** delete; the task stays visible as `[X]`.

### `move_todo_to_top` — reorder

```json
{ "id": "k3j9x2" }
```

Moves the task to index 0. Does **not** change `completed`.
Fails if the task is deleted:
`Ошибка: Задача с ID <id> помечена как удалённая.`
Does not resurrect deleted tasks.

### `delete_todo` — soft-delete

```json
{ "id": "k3j9x2" }
```

Sets `deleted = true`. The task is hidden from `"all"`/`"active"`/
`"completed"` and skipped by `get_current_todo`. Idempotent-ish:
re-calling on an already-deleted task returns
`Задача с ID <id> уже помечена как удалённая.`

**There is no `restore_todo` or `purge_todo` in the current build.**
If the user asks to restore or hard-delete, tell them the server
only supports soft-delete and the task remains visible via
`list_todos({filterStatus:"deleted"})` and `get_todo_by_id`.

## Resource catalog (only if your client exposes them)

- `todo://list` — same output as `list_todos`. Supports a query
  parameter: `todo://list?status=active|completed|deleted` (default
  `all`).
- `todo://current` — same output as `get_current_todo`.

There is no resource for counting; use `count_todos`.

## Standard workflows

### A. "How many tasks?" / "Сколько задач?"

1. `count_todos()`.
2. Report `Всего (без удалённых)` as the headline number.
3. If `Удалённых (скрытых) > 0`, mention it explicitly — the user
   may have forgotten about soft-deleted tasks.
4. If they want the list, follow with `list_todos({filterStatus:"active"})`.

**Do not** claim you cannot count.

### B. Add a task and make it the priority

1. `add_todo({ text: "Write report" })` → capture the new ID.
2. `move_todo_to_top({ id: "<new id>" })`.
3. `get_current_todo()` to confirm it is now first.

### C. Complete the current task, then see what's next

1. `get_current_todo()` → get the ID.
2. `complete_todo({ id: "<current id>" })`.
3. `get_current_todo()` again → next active task (the just-completed
   one is skipped).

### D. Delete a task (soft)

1. `list_todos({filterStatus:"active"})` (or `"all"`) → find the ID.
2. `delete_todo({ id })`.
3. Confirm with `list_todos({filterStatus:"active"})` — the task
   is gone from the active view. It is still reachable via
   `list_todos({filterStatus:"deleted"})` and `get_todo_by_id`.

### E. Show what was deleted

1. `list_todos({ filterStatus: "deleted" })`.
2. If the user wants details on a specific one:
   `get_todo_by_id({ id })` (works even for deleted tasks).

### F. Find a task by text

1. `list_todos({ filterStatus: "all" })` (or `"active"` if you know
   it is not completed).
2. Locate the line whose text matches; take its `ID:` value.
3. Use that ID for `complete_todo` / `move_todo_to_top` /
   `delete_todo` / `get_todo_by_id`.

### G. Reorder by priority

1. `list_todos({ filterStatus: "active" })` → target ID.
2. `move_todo_to_top({ id: "<target id>" })`.
3. `get_current_todo()` → confirms the moved task is now priority.

### H. "Clear finished tasks"

The server has **no hard-delete and no bulk-clear**. Two options:

- Soft-delete one at a time: `delete_todo({ id })` for each
  `[X]` task from `list_todos({filterStatus:"completed"})`.
- Explain the limitation: completed tasks remain in memory;
  soft-deleting them hides them but does not free the record.

Do **not** invent a `clear_completed` / `purge` tool.

## Pitfalls

- **Do not answer "I have no way to list/count tasks."** That is
  false for this server. Use `list_todos` / `count_todos` /
  `get_current_todo`. If those tools are genuinely absent from
  your tool list, the server build is outdated — say so explicitly,
  but do not fabricate a different limitation.
- **"all" does not mean "including deleted".** `filterStatus:"all"`
  hides deleted tasks by design. Use `"deleted"` explicitly.
- **Position vs ID.** `Позиция` is display-only, per-filter, and
  shifts after reorders. Mutations take IDs.
- **Deleted tasks are read-only for mutators.** `complete_todo` and
  `move_todo_to_top` will error on `deleted: true`. Do not retry
  hoping for a different outcome; if resurrection is needed, tell
  the user the current server has no `restore_todo`.
- **`get_todo_by_id` sees deleted tasks** — that is intentional.
  Do not "correct" its output to hide `Удалена`.
- **`complete_todo` is not a delete.** Re-calling it on an already-
  completed task is harmless but does not remove or hide it.
- **`get_current_todo` is first-active, not first-overall.** Top
  entries may be `[X]` or `[D]`; they are skipped.
- **Order stability across filters.** Array order is stable, but
  `Позиция` numbers differ between `"all"`, `"active"`, and
  `"deleted"`. Do not use positions from one filter in another.
- **No persistence.** After a server restart, the list resets —
  including any soft-deleted tasks.
- **Re-read after mutations.** A stale `list_todos` snapshot is not
  authoritative after add/complete/move/delete.

## Reading responses

- **All tools** return `content[0].text`. Success and failure are
  conveyed in that text.
- **Errors are soft.** A text beginning with `"Ошибка:"` (e.g.
  `Ошибка: Задача с ID <id> не найдена.` or
  `Ошибка: Задача с ID <id> помечена как удалённая.`) means the
  operation was refused. Re-read via `list_todos`, pick a valid,
  non-deleted ID, retry.
- **Extract machine values from text.** After `add_todo`, parse the
  ID from `ID: <id>`. After `get_todo_by_id`, treat `В процессе` /
  `Выполнена` / `Удалена` as the status token.
- **Resources**, when available, return `contents[0].text` — one
  formatted blob per URI, identical to the corresponding tool.
- **`count_todos` has four numbers, not one.** When the user asks
  "how many", quote the headline (`Всего (без удалённых)`) and
  mention hidden deleted tasks if that number is non-zero.
