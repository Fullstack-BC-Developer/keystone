import { humanize } from '../../../lib/utils';
import {
  fieldType,
  FieldTypeFunc,
  BaseGeneratedListTypes,
  CommonFieldConfig,
  graphql,
  orderDirectionEnum,
  Decimal,
  filters,
  FieldData,
} from '../../../types';
import { resolveView } from '../../resolve-view';
import { assertCreateIsNonNullAllowed, assertReadIsNonNullAllowed } from '../../non-null-graphql';

export type DecimalFieldConfig<TGeneratedListTypes extends BaseGeneratedListTypes> =
  CommonFieldConfig<TGeneratedListTypes> & {
    validation?: {
      min?: string;
      max?: string;
      isRequired?: boolean;
    };
    precision?: number;
    scale?: number;
    defaultValue?: string;
    isIndexed?: boolean | 'unique';
    graphql?: { create?: { isNonNull?: boolean } };
  } & (
      | { isNullable?: true }
      | {
          isNullable: false;
          graphql?: { read?: { isNonNull?: boolean } };
        }
    );

function parseDecimalValueOption(meta: FieldData, value: string, name: string) {
  let decimal: Decimal;
  try {
    decimal = new Decimal(value);
  } catch (err) {
    throw new Error(
      `The decimal field at ${meta.listKey}.${meta.fieldKey} specifies ${name}: ${value}, this is not valid decimal value.`
    );
  }
  if (!decimal.isFinite()) {
    throw new Error(
      `The decimal field at ${meta.listKey}.${meta.fieldKey} specifies ${name}: ${value} which is not finite but ${name} must be finite.`
    );
  }
  return decimal;
}

export const decimal =
  <TGeneratedListTypes extends BaseGeneratedListTypes>({
    isIndexed,
    precision = 18,
    scale = 4,
    validation,
    defaultValue,
    ...config
  }: DecimalFieldConfig<TGeneratedListTypes> = {}): FieldTypeFunc =>
  meta => {
    if (meta.provider === 'sqlite') {
      throw new Error('The decimal field does not support sqlite');
    }

    if (!Number.isInteger(scale)) {
      throw new Error(
        `The scale for decimal fields must be an integer but the scale for the decimal field at ${meta.listKey}.${meta.fieldKey} is not an integer`
      );
    }

    if (!Number.isInteger(precision)) {
      throw new Error(
        `The precision for decimal fields must be an integer but the precision for the decimal field at ${meta.listKey}.${meta.fieldKey} is not an integer`
      );
    }

    if (scale > precision) {
      throw new Error(
        `The scale configured for decimal field at ${meta.listKey}.${meta.fieldKey} (${scale}) ` +
          `must not be larger than the field's precision (${precision})`
      );
    }

    const fieldLabel = config.label ?? humanize(meta.fieldKey);

    const max =
      validation?.max === undefined
        ? undefined
        : parseDecimalValueOption(meta, validation.max, 'validation.max');
    const min =
      validation?.max === undefined
        ? undefined
        : parseDecimalValueOption(meta, validation.max, 'validation.max');

    if (min !== undefined && max !== undefined && max.lessThan(min)) {
      throw new Error(
        `The decimal field at ${meta.listKey}.${meta.fieldKey} specifies a validation.max that is less than the validation.min, and therefore has no valid options`
      );
    }

    const parsedDefaultValue =
      defaultValue === undefined
        ? undefined
        : parseDecimalValueOption(meta, defaultValue, 'defaultValue');

    if (config.isNullable === false) {
      assertReadIsNonNullAllowed(meta, config);
    }
    assertCreateIsNonNullAllowed(meta, config);

    const mode = config.isNullable === false ? 'required' : 'optional';

    const index = isIndexed === true ? 'index' : isIndexed || undefined;
    const dbField = {
      kind: 'scalar',
      mode,
      scalar: 'Decimal',
      nativeType: `Decimal(${precision}, ${scale})`,
      index,
      default:
        defaultValue === undefined ? undefined : { kind: 'literal' as const, value: defaultValue },
    } as const;
    return fieldType(dbField)({
      ...config,
      hooks: {
        ...config.hooks,
        async validateInput(args) {
          const val: Decimal | null | undefined = args.resolvedData[meta.fieldKey];

          if (val === null && validation?.isRequired) {
            args.addValidationError(`${fieldLabel} is required`);
          }
          if (val != null) {
            if (min !== undefined && val.lessThan(min)) {
              args.addValidationError(`${fieldLabel} must be greater than or equal to ${min}`);
            }

            if (max !== undefined && val.greaterThan(max)) {
              args.addValidationError(`${fieldLabel} must be less than or equal to ${max}`);
            }
          }

          await config.hooks?.validateInput?.(args);
        },
      },
      input: {
        where: {
          arg: graphql.arg({ type: filters[meta.provider].Decimal[mode] }),
          resolve: mode === 'optional' ? filters.resolveCommon : undefined,
        },
        create: {
          arg: graphql.arg({
            type: config.graphql?.create?.isNonNull
              ? graphql.nonNull(graphql.Decimal)
              : graphql.Decimal,
            defaultValue: config.graphql?.create?.isNonNull ? parsedDefaultValue : undefined,
          }),
          resolve(val) {
            if (val === undefined) {
              return parsedDefaultValue ?? null;
            }
            return val;
          },
        },
        update: {
          arg: graphql.arg({ type: graphql.Decimal }),
        },
        orderBy: { arg: graphql.arg({ type: orderDirectionEnum }) },
      },
      output: graphql.field({
        type:
          config.isNullable === false && config.graphql?.read?.isNonNull
            ? graphql.nonNull(graphql.Decimal)
            : graphql.Decimal,
        resolve({ value }) {
          if (value === null) {
            return null;
          }
          const val: Decimal & { scaleToPrint?: number } = new Decimal(value);
          val.scaleToPrint = scale;
          return val;
        },
      }),
      views: resolveView('decimal/views'),
      getAdminMeta: (): import('./views').DecimalFieldMeta => ({
        defaultValue: defaultValue ?? null,
        precision,
        scale,
        validation: {
          isRequired: validation?.isRequired ?? false,
          max: validation?.max ?? null,
          min: validation?.min ?? null,
        },
      }),
    });
  };
