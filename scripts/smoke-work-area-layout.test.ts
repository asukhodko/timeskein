import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_WORK_AREA_HEIGHT_PX,
  clampWorkAreaHeight,
  defaultWorkAreaHeight,
} from '../apps/desktop/src/utils/workAreaLayout'

test('work area divider resizes the complete upper area within inventory-safe bounds', () => {
  assert.equal(clampWorkAreaHeight(100, 1000), MIN_WORK_AREA_HEIGHT_PX)
  assert.equal(clampWorkAreaHeight(520, 1000), 520)
  assert.equal(clampWorkAreaHeight(900, 1000), 740)
})

test('work area default is viewport-relative and leaves inventory visible', () => {
  assert.equal(defaultWorkAreaHeight(1000), 580)
  assert.equal(defaultWorkAreaHeight(400), MIN_WORK_AREA_HEIGHT_PX)
})
