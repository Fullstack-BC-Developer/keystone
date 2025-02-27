import inflection from 'inflection';
import { humanize } from '../../../lib/utils';
import {
  BaseGeneratedListTypes,
  fieldType,
  FieldTypeFunc,
  CommonFieldConfig,
  orderDirectionEnum,
  graphql,
  filters,
} from '../../../types';
import { assertCreateIsNonNullAllowed, assertReadIsNonNullAllowed } from '../../non-null-graphql';
import { resolveView } from '../../resolve-view';

export type SelectFieldConfig<TGeneratedListTypes extends BaseGeneratedListTypes> =
  CommonFieldConfig<TGeneratedListTypes> &
    (
      | {
          /**
           * When a value is provided as just a string, it will be formatted in the same way
           * as field labels are to create the label.
           */
          options: ({ label: string; value: string } | string)[];
          /**
           * If `enum` is provided on SQLite, it will use an enum in GraphQL but a string in the database.
           */
          type?: 'string' | 'enum';
          defaultValue?: string;
        }
      | {
          options: { label: string; value: number }[];
          type: 'integer';
          defaultValue?: number;
        }
    ) & {
      ui?: {
        displayMode?: 'select' | 'segmented-control';
      };

      validation?: {
        /**
         * @default false
         */
        isRequired?: boolean;
      };
      isIndexed?: boolean | 'unique';
      graphql?: {
        create?: {
          isNonNull?: boolean;
        };
      };
    } & (
      | { isNullable?: true }
      | {
          isNullable: false;
          graphql?: {
            read?: {
              isNonNull?: boolean;
            };
          };
        }
    );

// These are the max and min values available to a 32 bit signed integer
const MAX_INT = 2147483647;
const MIN_INT = -2147483648;

export const select =
  <TGeneratedListTypes extends BaseGeneratedListTypes>({
    isIndexed,
    ui: { displayMode = 'select', ...ui } = {},
    defaultValue,
    validation,
    ...config
  }: SelectFieldConfig<TGeneratedListTypes>): FieldTypeFunc =>
  meta => {
    const fieldLabel = config.label ?? humanize(meta.fieldKey);
    if (config.isNullable === false) {
      assertReadIsNonNullAllowed(meta, config);
    }
    assertCreateIsNonNullAllowed(meta, config);
    const commonConfig = (
      options: { value: string | number; label: string }[]
    ): CommonFieldConfig<TGeneratedListTypes> & {
      views: string;
      getAdminMeta: () => import('./views').AdminSelectFieldMeta;
    } => {
      const values = new Set(options.map(x => x.value));
      if (values.size !== options.length) {
        throw new Error(
          `The select field at ${meta.listKey}.${meta.fieldKey} has duplicate options, this is not allowed`
        );
      }
      return {
        ...config,
        ui,
        hooks: {
          ...config.hooks,
          async validateInput(args) {
            const value = args.resolvedData[meta.fieldKey];
            if (value != null && !values.has(value)) {
              args.addValidationError(`${value} is not a possible value for ${fieldLabel}`);
            }
            if (
              validation?.isRequired &&
              (value === null || (value === undefined && args.operation === 'create'))
            ) {
              args.addValidationError(`${fieldLabel} is required`);
            }
            await config.hooks?.validateInput?.(args);
          },
        },
        views: resolveView('select/views'),
        getAdminMeta: () => ({
          options,
          type: config.type ?? 'string',
          displayMode: displayMode,
          defaultValue: defaultValue ?? null,
          isRequired: validation?.isRequired ?? false,
        }),
      };
    };
    const mode = config.isNullable === false ? 'required' : 'optional';
    const commonDbFieldConfig = {
      mode,
      index: isIndexed === true ? 'index' : isIndexed || undefined,
      default:
        defaultValue === undefined
          ? undefined
          : { kind: 'literal' as const, value: defaultValue as any },
    } as const;

    const resolveCreate = <T extends string | number>(val: T | null | undefined): T | null => {
      if (val === undefined) {
        return (defaultValue as T | undefined) ?? null;
      }
      return val;
    };

    const output = <T extends graphql.NullableOutputType>(type: T) =>
      config.isNullable === false && config.graphql?.read?.isNonNull === true
        ? graphql.nonNull(type)
        : type;

    const create = <T extends graphql.NullableInputType>(type: T) => {
      const isNonNull = config.isNullable === false && config.graphql?.read?.isNonNull === true;
      return graphql.arg({
        type: isNonNull ? graphql.nonNull(type) : type,
        defaultValue: isNonNull ? defaultValue : undefined,
      });
    };

    if (config.type === 'integer') {
      if (
        config.options.some(
          ({ value }) => !Number.isInteger(value) || value > MAX_INT || value < MIN_INT
        )
      ) {
        throw new Error(
          `The select field at ${meta.listKey}.${meta.fieldKey} specifies integer values that are outside the range of a 32 bit signed integer`
        );
      }
      return fieldType({
        kind: 'scalar',
        scalar: 'Int',
        ...commonDbFieldConfig,
      })({
        ...commonConfig(config.options),
        input: {
          where: {
            arg: graphql.arg({ type: filters[meta.provider].Int[mode] }),
            resolve: mode === 'required' ? undefined : filters.resolveCommon,
          },
          create: { arg: create(graphql.Int), resolve: resolveCreate },
          update: { arg: graphql.arg({ type: graphql.Int }) },
          orderBy: { arg: graphql.arg({ type: orderDirectionEnum }) },
        },
        output: graphql.field({ type: output(graphql.Int) }),
      });
    }
    const options = config.options.map(option => {
      if (typeof option === 'string') {
        return {
          label: humanize(option),
          value: option,
        };
      }
      return option;
    });

    if (config.type === 'enum') {
      const enumName = `${meta.listKey}${inflection.classify(meta.fieldKey)}Type`;
      const graphQLType = graphql.enum({
        name: enumName,
        values: graphql.enumValues(options.map(x => x.value)),
      });
      return fieldType(
        meta.provider === 'sqlite'
          ? { kind: 'scalar', scalar: 'String', ...commonDbFieldConfig }
          : {
              kind: 'enum',
              values: options.map(x => x.value),
              name: enumName,
              ...commonDbFieldConfig,
            }
      )({
        ...commonConfig(options),
        input: {
          where: {
            arg: graphql.arg({ type: filters[meta.provider].enum(graphQLType).optional }),
            resolve: mode === 'required' ? undefined : filters.resolveCommon,
          },
          create: { arg: create(graphQLType), resolve: resolveCreate },
          update: { arg: graphql.arg({ type: graphQLType }) },
          orderBy: { arg: graphql.arg({ type: orderDirectionEnum }) },
        },
        output: graphql.field({ type: output(graphQLType) }),
      });
    }
    return fieldType({ kind: 'scalar', scalar: 'String', ...commonDbFieldConfig })({
      ...commonConfig(options),
      input: {
        where: {
          arg: graphql.arg({ type: filters[meta.provider].String[mode] }),
          resolve: mode === 'required' ? undefined : filters.resolveString,
        },
        create: { arg: create(graphql.String), resolve: resolveCreate },
        update: { arg: graphql.arg({ type: graphql.String }) },
        orderBy: { arg: graphql.arg({ type: orderDirectionEnum }) },
      },
      output: graphql.field({ type: output(graphql.String) }),
    });
  };
