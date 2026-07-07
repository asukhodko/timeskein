export const ITEM_UI_LABELS = {
  createTitle: 'Создать дело',
  createError: 'Не удалось создать дело',
  duplicateTitleError: 'Дело с таким названием уже есть',
  noteDescription: 'Описание дела',
  deleteTitle: 'Удалить дело',
} as const

export function formatCreateItemError(error: unknown) {
  if (error instanceof Error && /work item with this title already exists/i.test(error.message)) {
    return ITEM_UI_LABELS.duplicateTitleError
  }

  return error instanceof Error ? error.message : ITEM_UI_LABELS.createError
}
