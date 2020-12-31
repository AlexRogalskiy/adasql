import {
  ColumnMetadata,
  Field
} from '@aws-sdk/client-rds-data';

import {
  ColumnValue,
  Row
} from './types';

function getAuroraDataValue (value: Field): ColumnValue {
  if ('blobValue' in value) {
    return value.blobValue;
  } else if ('doubleValue' in value) {
    return value.doubleValue;
  } else if ('isNull' in value) {
    return null;
  } else if ('longValue' in value) {
    return value.longValue;
  } else if ('stringValue' in value) {
    return value.stringValue;
  } else /* istanbul ignore else */ if ('booleanValue' in value) {
    return value.booleanValue;
  } else {
    const type = Object.keys(value)[0];
    throw new Error(`Unknown value type '${type}' from row`);
  }
}

export default function hydrateRecords (records: Field[][], fields: ColumnMetadata[]): Row[] {
  return records.map(record => record.reduce((row, value, index): Row => {
    const field = fields[index];

    let hydratedValue = getAuroraDataValue(value);

    if (hydratedValue !== null) {
      switch (field.typeName) {
        case 'DECIMAL':
          hydratedValue = Number(hydratedValue);
          break;

        case 'DATE':
        case 'DATETIME':
        case 'TIMESTAMP':
        case 'YEAR':
          hydratedValue = new Date(hydratedValue + 'Z');
          break;

        default:
          break;
      }
    }

    row[field.label as string] = hydratedValue;

    return row;
  }, {} as Row));
}