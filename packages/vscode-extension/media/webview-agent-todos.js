// Todo state is delivered by the host through typed todoUpdate events.

function findFailedAgentTodoLabel(todos) {
  var failedTodo = (todos || []).find(function(todo) {
    return todo && todo.status === 'failed' && todo.title;
  });
  if (!failedTodo) return '';
  return failedTodo.title.length > 52 ? failedTodo.title.slice(0, 50) + '...' : failedTodo.title;
}
