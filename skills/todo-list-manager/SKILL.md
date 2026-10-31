---
name: todo-list-manager
description: Manage a prioritized to-do list using the todo-manager MCP server. Use this skill when the user asks to add tasks, mark tasks complete, count or list tasks, get the current/priority task, or reorder tasks. Read operations are exposed as BOTH tools (list_todos, count_todos, get_current_todo, get_todo_by_id) and resources (todo://list, todo://current); ALWAYS prefer the tools because many MCP clients do not expose resources to the model. State changes go through add_todo, complete_todo, move_todo_to_top. The list is in-memory and resets when the server restarts.
---

# todo-manager — prioritized to-do list

The `todo-manager` MCP server keeps an ordered, in-memory to-do list.
Each task has an `id` (opaque string), `text`, and `completed` flag.
Order is meaningful: the first *active* (non-completed) task is the
"current" priority task.

## CRITICAL: tools first, resources second

This server exposes the same read data twice:

| Data              | Tool (always callable)   | Resource (client-dependent) |
|-------------------|--------------------------|-----------------------------|
| Full list         | `list_todos`             | `todo://list`               |
| Task count        | `count_todos`            | — (count from `list_todos`) |
| Current priority  | `get_current_todo`       | `todo://current`            |
| Single task by ID | `get_todo_by_id`         | —                           |

**Many MCP clients (including CLI agents) do NOT expose resources as
callable actions.** If you see only tools in your tool list, that is
normal — use `list_todos`, `count_todos`, `get_current_todo`. Do not
respond "I cannot list/count tasks" and do not ask the user for a
tool that does not exist. The read tools above ARE the list/count
operations.

## Quick start

There is no mandatory `open` call — the server is always ready.
For any question about state (how many, what's current, which ID),
start with a read tool:

- count question → `count_todos()`
- "what's on my list" → `list_todos()`
- "what should I do now" → `get_current_todo()`
- "status of task X" (ID known) → `get_todo_by_id({ id })`

## Key concepts

- **Tools mutate AND read; resources are a bonus.** Use tools.
- **IDs are opaque strings.** `add_todo` returns something like
  `"k3j9x2"`. Always pass IDs back verbatim; never use a task's
  position number for mutations.
- **Completed tasks stay in the list.** `complete_todo` sets the
  `completed` flag; it does *not* remove the task. `list_todos`
  shows both `[ ]` and `[X]` entries.
- **"Current" = first active task.** `get_current_todo` returns the
  first task with `completed == false`. If all tasks are done, it
  reports "Нет активных задач в списке."
- **Ordering is array order.** `move_todo_to_top` splices the task
  out and `unshift`s it to index 0. `add_todo` appends to the end.
- **In-memory only.** The list resets when the server process
  restarts. Do not promise persistence.
- **Responses are in Russian.** Parse the returned ID from
  `add_todo` rather than the human text when you need a machine
  value.

## Tool catalog

### Read tools (use these, not resources)

#### `count_todos` — number of tasks

```json
{}
```

Returns: `Всего задач: N. Активных: A. Выполненных: C.`
This is the direct answer to "сколько задач", "how many tasks",
"how many are left", etc.

#### `list_todos` — full list

```json
{}
```

Returns one line per task, in array order:

```
[ ] ID: 1 (Позиция: 1) - Изучить спецификацию Model Context Protocol
[X] ID: 2 (Позиция: 2) - Написать MCP-сервер для To-Do списка
```

`[ ]` = active, `[X]` = completed. `Позиция` is the 1-based index
**at read time** — it shifts after any reorder. Empty list returns
`Список задач пуст.`

#### `get_current_todo` — priority task

```json
{}
```

Returns the first active task:

```
Текущая активная задача:
[ ] ID: <id> - <text>
```

If every task is completed: `Нет активных задач в списке.`

#### `get_todo_by_id` — read one task

```json
{ "id": "k3j9x2" }
```

Returns ID, text, and status (`Выполнена` / `В процессе`).
Use only when you already have the ID; otherwise `list_todos` first.

Failure: `Задача с ID <id> не найдена.`

### Mutation tools

#### `add_todo` — create a task

```json
{ "text": "Buy groceries" }
```

Appends a new incomplete task to the **end** of the list.
Response: `Задача успешно добавлена. ID: <id>` — extract `<id>`
for follow-up calls.

#### `complete_todo` — mark done

```json
{ "id": "k3j9x2" }
```

Sets `completed = true`. The task remains in the list;
`get_current_todo` will skip it.

#### `move_todo_to_top` — reorder

```json
{ "id": "k3j9x2" }
```

Moves the task to **position 0**. Does **not** change its
`completed` flag. If the task is already completed, it moves but
`get_current_todo` still skips it.

## Resource catalog (only if your client exposes them)

If — and only if — your client lists resources, you may read:

- `todo://list` — identical output to `list_todos`.
- `todo://current` — identical output to `get_current_todo`.

There is no resource for counting; use `count_todos`.

## Standard workflows

### A. "How many tasks?" / "Сколько задач?"

1. `count_todos()` → report `Всего / Активных / Выполненных`.
   If the user also wants the list, follow with `list_todos()`.
   **Do not** claim you cannot count.

### B. Add a task and make it the priority

1. `add_todo({ text: "Write report" })` → capture the new ID.
2. `move_todo_to_top({ id: "<new id>" })`.
3. `get_current_todo()` to confirm it is now first.

### C. Complete the current task, then see what's next

1. `get_current_todo()` → get the ID.
2. `complete_todo({ id: "<current id>" })`.
3. `get_current_todo()` again → next active task
   (the just-completed one is skipped).

### D. Find a task by text

1. `list_todos()`.
2. Locate the line whose text matches; take its `ID:` value.
3. Use that ID for `complete_todo` / `move_todo_to_top` /
   `get_todo_by_id`.

### E. Reorder by priority

1. `list_todos()` → find the target ID.
2. `move_todo_to_top({ id: "<target id>" })`.
3. `get_current_todo()` → confirms the moved task is now priority.

### F. Bulk cleanup of completed tasks

`complete_todo` only flips the flag; the server does not delete.
If the user asks to "clear finished tasks", explain that no delete
tool exists and that completed entries remain visible with `[X]`.
Do not call `complete_todo` again hoping it removes them.

## Pitfalls

- **Do not confuse position with ID.** `Позиция` is display-only
  and shifts after `move_todo_to_top`. Mutations take IDs.
- **Do not answer "I have no way to list/count tasks."** That is
  false for this server. Use `list_todos` / `count_todos` /
  `get_current_todo`. If those tools are genuinely absent from
  your tool list, the server build is outdated — say so explicitly,
  but do not fabricate a different limitation.
- **Resources may be invisible.** Absence of `todo://list` in your
  tool/resource list does not mean the list is unreadable; the
  tool mirror exists.
- **`complete_todo` is not a delete.** Re-calling it on an
  already-completed task is harmless but does not remove it.
- **Moving a completed task to the top is allowed** but keeps
  `completed = true`; `get_current_todo` will still skip it.
- **`get_current_todo` is first-active, not first-overall.** If
  the top entry is `[X]`, it returns the next `[ ]` entry below.
- **No persistence.** After a server restart, the list resets.
- **IDs are session-scoped.** Do not cache an ID across restarts.
- **Re-read after mutations.** Order and status change; a stale
  `list_todos` snapshot is not authoritative after a move or
  completion.

## Reading responses

- **All tools** return `content[0].text`. Success and failure are
  conveyed in that text.
- **Errors are soft.** A text beginning with `"Ошибка:"` (e.g.
  `Ошибка: Задача с ID <id> не найдена.`) means the ID was not
  found. Re-read via `list_todos`, pick a valid ID, retry.
- **Extract machine values from text.** After `add_todo`, parse
  the ID from `ID: <id>`. After `get_todo_by_id`, treat
  `Выполнена` / `В процессе` as the status token.
- **Resources**, when available, return `contents[0].text` — one
  formatted blob per URI, identical to the corresponding tool.
