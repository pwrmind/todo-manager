import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

// Определение структуры задачи
interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}

// Хранилище задач в памяти
let todoList: TodoItem[] = [
  { id: "1", text: "Изучить спецификацию Model Context Protocol", completed: false },
  { id: "2", text: "Написать MCP-сервер для To-Do списка", completed: false },
];

// Инициализация MCP-сервера
const server = new McpServer({
  name: "todo-manager",
  version: "1.0.0",
});

// Вспомогательная функция для форматирования списка задач для LLM
const formatTodoList = (todos: TodoItem[]): string => {
  if (todos.length === 0) return "Список задач пуст.";
  return todos
    .map((t, idx) => `[${t.completed ? "X" : " "}] ID: ${t.id} (Позиция: ${idx + 1}) - ${t.text}`)
    .join("\n");
};

// ==========================================
// 1. РЕСУРСЫ (Чтение состояния списка)
// ==========================================

// 1.1. Ресурс полного списка задач
server.registerResource(
  "todo-list",
  "todo://list",
  {
    description: "Текущий список всех задач (выполненных и активных)",
    mimeType: "text/plain",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: formatTodoList(todoList),
      },
    ],
  })
);

// 1.2. Ресурс текущей активной задачи
server.registerResource(
  "current-todo",
  "todo://current",
  {
    description: "Текущая самая приоритетная задача (находится на вершине списка)",
    mimeType: "text/plain",
  },
  async (uri) => {
    const current = todoList.find((t) => !t.completed);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: current
            ? `Текущая активная задача:\n[ ] ID: ${current.id} - ${current.text}`
            : "Нет активных задач в списке.",
        },
      ],
    };
  }
);

// ==========================================
// 2. READ-ИНСТРУМЕНТЫ (tool-зеркала ресурсов)
//    Нужны, потому что не все MCP-клиенты
//    отдают ресурсы модели как вызываемые действия.
// ==========================================

// Инструмент: Полный список задач
server.registerTool(
  "list_todos",
  {
    description:
      "Возвращает полный список задач: позиция, ID, статус ([ ]/[X]) и текст. " +
      "Используйте, когда нужно перечислить задачи, посчитать их или найти ID по тексту.",
    inputSchema: z.object({}),
  },
  async () => ({
    content: [{ type: "text", text: formatTodoList(todoList) }],
  })
);

// Инструмент: Количество задач
server.registerTool(
  "count_todos",
  {
    description:
      "Возвращает количество задач: всего, активных и выполненных. " +
      "Используйте для вопросов «сколько задач в списке?».",
    inputSchema: z.object({}),
  },
  async () => {
    const total = todoList.length;
    const completed = todoList.filter((t) => t.completed).length;
    const active = total - completed;
    return {
      content: [
        {
          type: "text",
          text: `Всего задач: ${total}. Активных: ${active}. Выполненных: ${completed}.`,
        },
      ],
    };
  }
);

// Инструмент: Текущая (топовая) активная задача
server.registerTool(
  "get_current_todo",
  {
    description:
      "Возвращает текущую самую приоритетную активную задачу — первую невыполненную в списке. " +
      "Зеркало ресурса todo://current для клиентов, которые не показывают ресурсы.",
    inputSchema: z.object({}),
  },
  async () => {
    const current = todoList.find((t) => !t.completed);
    return {
      content: [
        {
          type: "text",
          text: current
            ? `Текущая активная задача:\n[ ] ID: ${current.id} - ${current.text}`
            : "Нет активных задач в списке.",
        },
      ],
    };
  }
);

// ==========================================
// 3. ИНСТРУМЕНТЫ (Действия со списком)
// ==========================================

// Инструмент: Добавить задачу
server.registerTool(
  "add_todo",
  {
    description: "Добавляет новую задачу в конец списка.",
    inputSchema: z.object({ text: z.string().min(1).describe("Текст задачи") }),
  },
  async ({ text }) => {
    const newTodo: TodoItem = {
      id: Math.random().toString(36).substring(2, 11),
      text,
      completed: false,
    };
    todoList.push(newTodo);
    return {
      content: [{ type: "text", text: `Задача успешно добавлена. ID: ${newTodo.id}` }],
    };
  }
);

// Инструмент: Отметить выполненной
server.registerTool(
  "complete_todo",
  {
    description: "Отмечает задачу как выполненную по её ID.",
    inputSchema: z.object({ id: z.string().describe("Уникальный ID задачи") }),
  },
  async ({ id }) => {
    const todo = todoList.find((t) => t.id === id);
    if (!todo) {
      return { content: [{ type: "text", text: `Ошибка: Задача с ID ${id} не найдена.` }] };
    }
    todo.completed = true;
    return {
      content: [{ type: "text", text: `Задача "${todo.text}" (ID: ${id}) отмечена как выполненная.` }],
    };
  }
);

// Инструмент: Получить конкретную задачу по ID
server.registerTool(
  "get_todo_by_id",
  {
    description: "Возвращает детали конкретной задачи по её ID.",
    inputSchema: z.object({ id: z.string().describe("Уникальный ID задачи") }),
  },
  async ({ id }) => {
    const todo = todoList.find((t) => t.id === id);
    if (!todo) {
      return { content: [{ type: "text", text: `Задача с ID ${id} не найдена.` }] };
    }
    return {
      content: [
        {
          type: "text",
          text: `Задача найдена:\nID: ${todo.id}\nТекст: ${todo.text}\nСтатус: ${todo.completed ? "Выполнена" : "В процессе"}`,
        },
      ],
    };
  }
);

// Инструмент: Переместить в самый топ (On Top)
server.registerTool(
  "move_todo_to_top",
  {
    description: "Перемещает существующую задачу в самый верх списка, делая её приоритетной.",
    inputSchema: z.object({ id: z.string().describe("Уникальный ID задачи, которую нужно поднять в топ") }),
  },
  async ({ id }) => {
    const index = todoList.findIndex((t) => t.id === id);
    if (index === -1) {
      return { content: [{ type: "text", text: `Ошибка: Задача с ID ${id} не найдена.` }] };
    }

    const [todo] = todoList.splice(index, 1);
    todoList.unshift(todo);

    return {
      content: [{ type: "text", text: `Задача "${todo.text}" успешно перемещена на вершину списка!` }],
    };
  }
);

// ==========================================
// 4. ЗАПУСК СЕРВЕРА
// ==========================================
serveStdio(() => server);
console.error("MCP To-Do сервер успешно запущен!");