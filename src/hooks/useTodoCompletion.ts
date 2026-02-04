import { useMemo } from 'react';
import { TodoItem } from '@/types/settings';

/**
 * Custom hook to manage todo completion
 * Returns all todos - completed items remain visible
 */
export function useTodoCompletion(todos: TodoItem[] | undefined) {
  // Simply return all todos - no hiding logic
  const visibleTodos = useMemo(() => {
    if (!todos || todos.length === 0) return [];
    return todos;
  }, [todos]);

  return visibleTodos;
}
