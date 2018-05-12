import {Modifier} from 'draft-js';
import unicodeSubstring from 'unicode-substring';
import {EditorState, convertFromRaw, convertToRaw} from 'draft-js';

const getUTF16Range = (text, range) => {
  const offset = unicodeSubstring(text, 0, range.offset).length;
  return {
    key: range.key,
    offset,
    length: offset + unicodeSubstring(text, offset, range.length).length
  };
};

const getEntities = (entityMap, entityType, eqFn) => {
  const entityKeys = Object.keys(entityMap);
  const entities = [];
  for (let i = 0; i < entityKeys.length; i++) {
    const key = entityKeys[i];
    const entity = entityMap[key];
    if (entity.type === entityType && eqFn(entity.data)) {
      entities.push(key);
    }
  }
  return entities;
};

const getRemovalRanges = (entities, entityRanges, text) => {
  const removalRanges = [];
  for (let j = 0; j < entityRanges.length; j++) {
    const utf8Range = entityRanges[j];
    const entityKey = String(utf8Range.key);
    if (entities.includes(entityKey)) {
      const {offset, length} = getUTF16Range(text, utf8Range);
      const entityEnd = offset + length;
      const end = offset === 0 && text[entityEnd] === ' ' ? entityEnd + 1 : entityEnd;
      const start = text[offset - 1] === ' ' ? offset - 1 : offset;
      removalRanges.push({start, end});
    }
  }
  removalRanges.sort((a, b) => (a.end < b.end ? 1 : -1));
  return removalRanges;
};

const removeAllRangesForEntity = (content, entityType, eqFn) => {
  const rawContent = JSON.parse(content);
  const {blocks, entityMap} = rawContent;
  const entities = getEntities(entityMap, entityType, eqFn);
  // it's an arduous task to update the next entities after removing 1, so use the removeRange helper
  const editorState = EditorState.createWithContent(convertFromRaw(rawContent));
  let contentState = editorState.getCurrentContent();
  const selectionState = editorState.getSelection();
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const {entityRanges, key: blockKey, text} = block;
    const removalRanges = getRemovalRanges(entities, entityRanges, text);
    for (let j = 0; j < removalRanges.length; j++) {
      const range = removalRanges[j];
      const selectionToRemove = selectionState.merge({
        anchorKey: blockKey,
        focusKey: blockKey,
        anchorOffset: range.start,
        focusOffset: range.end
      });
      contentState = Modifier.removeRange(contentState, selectionToRemove, 'backward');
    }
    if (contentState.getBlockForKey(blockKey).getText() === '') {
      contentState = contentState.merge({
        blockMap: contentState.getBlockMap().delete(blockKey)
      });
    }
  }
  return contentState === editorState.getCurrentContent()
    ? null
    : JSON.stringify(convertToRaw(contentState));
};

export default removeAllRangesForEntity;
