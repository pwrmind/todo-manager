import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

// ---------- Model ----------

interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  deleted: boolean;
}

let todoList: TodoItem[] = [
  { id: "1", text: "Study the Model Context Protocol specification", completed: false, deleted: false },
  { id: "2", text: "Build an MCP server for the to-do list", completed: false, deleted: false },
  { id: "3", text: "A new test task", completed: false, deleted: false },
];

// ---------- Server ----------

const server = new McpServer({
  name: "todo-manager",
  version: "1.0.0",
});

// ---------- Filtering and formatting ----------

type FilterStatus = "all" | "active" | "completed" | "deleted";

const filterTodos = (todos: TodoItem[], status: FilterStatus): TodoItem[] => {
  switch (status) {
    case "active":    return todos.filter(t => !t.deleted && !t.completed);
    case "completed": return todos.filter(t => !t.deleted &&  t.completed);
    case "deleted":   return todos.filter(t =>  t.deleted);
    case "all":
    default:          return todos.filter(t => !t.deleted);
  }
};

// Status marker inside a line: [ ] active, [X] completed, [D] deleted
const statusMarker = (t: TodoItem): string =>
  t.deleted ? "D" : t.completed ? "X" : " ";

const formatTodoList = (todos: TodoItem[], status: FilterStatus = "all"): string => {
  const filtered = filterTodos(todos, status);
  if (filtered.length === 0) return "The list is empty.";
  return filtered
    .map((t, idx) =>
      `[${statusMarker(t)}] ID: ${t.id} (Position: ${idx + 1}) - ${t.text}`,
    )
    .join("\n");
};

// ---------- Resources ----------

server.registerResource(
  "todo-list",
  "todo://list",
  {
    description:
      "Task list. By default, all non-deleted tasks. " +
      "Supports query ?status=active|completed|deleted.",
    mimeType: "text/plain",
  },
  async (uri) => {
    let status: FilterStatus = "all";
    try {
      const raw = new URL(uri.href).searchParams.get("status");
      if (raw === "all" || raw === "active" || raw === "completed" || raw === "deleted") {
        status = raw;
      }
    } catch {
      // malformed URI — fall back to "all"
    }
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: formatTodoList(todoList, status),
        },
      ],
    };
  },
);

server.registerResource(
  "current-todo",
  "todo://current",
  {
    description:
      "Current highest-priority active task (the first one that is neither completed nor deleted).",
    mimeType: "text/plain",
  },
  async (uri) => {
    const current = todoList.find(t => !t.completed && !t.deleted);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: current
            ? `Current active task:\n[ ] ID: ${current.id} - ${current.text}`
            : "There are no active tasks in the list.",
        },
      ],
    };
  },
);

// ---------- Read tools (resource mirrors) ----------

server.registerTool(
  "list_todos",
  {
    description:
      "Returns the task list filtered by status: " +
      "'all' (everything except deleted), 'active', 'completed', 'deleted'.",
    inputSchema: z.object({
      filterStatus: z
        .enum(["all", "active", "completed", "deleted"])
        .optional()
        .default("all")
        .describe("Filter: all | active | completed | deleted"),
    }),
  },
  async ({ filterStatus }) => ({
    content: [{ type: "text", text: formatTodoList(todoList, filterStatus) }],
  }),
);

server.registerTool(
  "count_todos",
  {
    description:
      "Returns task counts: total (excluding deleted), active, completed, and deleted. " +
      "Use this for questions like \"how many tasks are in the list?\".",
    inputSchema: z.object({}),
  },
  async () => {
    const visible = todoList.filter(t => !t.deleted);
    const active = visible.filter(t => !t.completed).length;
    const completed = visible.filter(t => t.completed).length;
    const deleted = todoList.length - visible.length;
    return {
      content: [
        {
          type: "text",
          text:
            `Total (excluding deleted): ${visible.length}. ` +
            `Active: ${active}. ` +
            `Completed: ${completed}. ` +
            `Deleted (hidden): ${deleted}.`,
        },
      ],
    };
  },
);

server.registerTool(
  "get_current_todo",
  {
    description:
      "Returns the current highest-priority active task — the first one that is neither completed nor deleted. " +
      "Mirror of the todo://current resource.",
    inputSchema: z.object({}),
  },
  async () => {
    const current = todoList.find(t => !t.completed && !t.deleted);
    return {
      content: [
        {
          type: "text",
          text: current
            ? `Current active task:\n[ ] ID: ${current.id} - ${current.text}`
            : "There are no active tasks in the list.",
        },
      ],
    };
  },
);

// ---------- Mutation tools ----------

server.registerTool(
  "add_todo",
  {
    description: "Adds a new task to the end of the list.",
    inputSchema: z.object({
      text: z.string().min(1).describe("Task text"),
    }),
  },
  async ({ text }) => {
    const newTodo: TodoItem = {
      id: Math.random().toString(36).substring(2, 11),
      text,
      completed: false,
      deleted: false,
    };
    todoList.push(newTodo);
    return {
      content: [
        { type: "text", text: `Task added successfully. ID: ${newTodo.id}` },
      ],
    };
  },
);

server.registerTool(
  "complete_todo",
  {
    description:
      "Marks a task as completed by its ID. Deleted tasks are not modified.",
    inputSchema: z.object({
      id: z.string().describe("Unique task ID"),
    }),
  },
  async ({ id }) => {
    const todo = todoList.find(t => t.id === id);
    if (!todo) {
      return {
        content: [{ type: "text", text: `Error: task with ID ${id} not found.` }],
      };
    }
    if (todo.deleted) {
      return {
        content: [
          { type: "text", text: `Error: task with ID ${id} is marked as deleted.` },
        ],
      };
    }
    todo.completed = true;
    return {
      content: [
        {
          type: "text",
          text: `Task "${todo.text}" (ID: ${id}) marked as completed.`,
        },
      ],
    };
  },
);

server.registerTool(
  "get_todo_by_id",
  {
    description:
      "Returns details of a specific task by its ID (including deleted ones).",
    inputSchema: z.object({
      id: z.string().describe("Unique task ID"),
    }),
  },
  async ({ id }) => {
    const todo = todoList.find(t => t.id === id);
    if (!todo) {
      return {
        content: [{ type: "text", text: `Task with ID ${id} not found.` }],
      };
    }
    const status = todo.deleted
      ? "Deleted"
      : todo.completed
        ? "Completed"
        : "In progress";
    return {
      content: [
        {
          type: "text",
          text: `Task found:\nID: ${todo.id}\nText: ${todo.text}\nStatus: ${status}`,
        },
      ],
    };
  },
);

server.registerTool(
  "move_todo_to_top",
  {
    description:
      "Moves a task to the very top of the list. Deleted tasks are not moved.",
    inputSchema: z.object({
      id: z.string().describe("Unique ID of the task to move to the top"),
    }),
  },
  async ({ id }) => {
    const index = todoList.findIndex(t => t.id === id);
    if (index === -1) {
      return {
        content: [{ type: "text", text: `Error: task with ID ${id} not found.` }],
      };
    }
    if (todoList[index].deleted) {
      return {
        content: [
          { type: "text", text: `Error: task with ID ${id} is marked as deleted.` },
        ],
      };
    }
    const [todo] = todoList.splice(index, 1);
    todoList.unshift(todo);
    return {
      content: [
        {
          type: "text",
          text: `Task "${todo.text}" moved to the top of the list!`,
        },
      ],
    };
  },
);

server.registerTool(
  "delete_todo",
  {
    description:
      "Soft-deletes a task: sets deleted=true and hides it from the default list. " +
      "The ID remains in memory; repeated calls are idempotent.",
    inputSchema: z.object({
      id: z.string().describe("Unique task ID"),
    }),
  },
  async ({ id }) => {
    const todo = todoList.find(t => t.id === id);
    if (!todo) {
      return {
        content: [{ type: "text", text: `Error: task with ID ${id} not found.` }],
      };
    }
    if (todo.deleted) {
      return {
        content: [
          { type: "text", text: `Task with ID ${id} is already marked as deleted.` },
        ],
      };
    }
    todo.deleted = true;
    return {
      content: [
        {
          type: "text",
          text: `Task "${todo.text}" (ID: ${id}) marked as deleted and hidden from the active list.`,
        },
      ],
    };
  },
);

// ---------- Launch ----------

serveStdio(() => server);
console.error("MCP To-Do server started successfully!");