import { text } from '@keystone-next/keystone/fields';
import { list } from '@keystone-next/keystone';
import { setupTestRunner } from '@keystone-next/keystone/testing';
import { apiTestConfig, expectAccessReturnError } from '../utils';

const runner = setupTestRunner({
  config: apiTestConfig({
    lists: {
      BadAccess: list({
        fields: { name: text({ isFilterable: true, isOrderable: true }) },
        access: {
          operation: {
            // @ts-ignore Intentionally return a filter for testing purposes
            query: () => {
              return { name: { not: { equals: 'bad' } } };
            },
            // @ts-ignore Intentionally return a filter for testing purposes
            create: () => {
              return { name: { not: { equals: 'bad' } } };
            },
            // @ts-ignore Intentionally return a filter for testing purposes
            update: () => {
              return { name: { not: { equals: 'bad' } } };
            },
            // @ts-ignore Intentionally return a filter for testing purposes
            delete: async () => {
              return { name: { not: { startsWtih: 'no delete' } } };
            },
          },
        },
      }),
    },
  }),
});

describe('Access control - Item', () => {
  test(
    'findMany - Bad function return value',
    runner(async ({ context, graphQLRequest }) => {
      // Valid name
      const { body } = await graphQLRequest({
        query: `query { badAccesses { id } }`,
      });

      // Returns null and throws an error
      expect(body.data).toEqual({ badAccesses: null });
      expectAccessReturnError(body.errors, [
        {
          path: ['badAccesses'],
          errors: [{ tag: 'BadAccess.access.operation.query', returned: 'object' }],
        },
      ]);

      // No items should exist
      const _items = await context.sudo().query.BadAccess.findMany({ query: 'id name' });
      expect(_items.map(({ name }) => name)).toEqual([]);
    })
  );

  test(
    'createOne - Bad function return value',
    runner(async ({ context, graphQLRequest }) => {
      // Valid name
      const { body } = await graphQLRequest({
        query: `mutation ($data: BadAccessCreateInput!) { createBadAccess(data: $data) { id } }`,
        variables: { data: { name: 'better' } },
      });

      // Returns null and throws an error
      expect(body.data).toEqual({ createBadAccess: null });
      expectAccessReturnError(body.errors, [
        {
          path: ['createBadAccess'],
          errors: [{ tag: 'BadAccess.access.operation.create', returned: 'object' }],
        },
      ]);

      // No items should exist
      const _users = await context.sudo().query.BadAccess.findMany({ query: 'id name' });
      expect(_users.map(({ name }) => name)).toEqual([]);
    })
  );

  test(
    'updateOne - Bad function return value',
    runner(async ({ context, graphQLRequest }) => {
      const item = await context.sudo().query.BadAccess.createOne({ data: { name: 'good' } });

      // Valid name
      const { body } = await graphQLRequest({
        query: `mutation ($id: ID! $data: BadAccessUpdateInput!) { updateBadAccess(where: { id: $id }, data: $data) { id } }`,
        variables: { id: item.id, data: { name: 'better' } },
      });

      // Returns null and throws an error
      expect(body.data).toEqual({ updateBadAccess: null });
      expectAccessReturnError(body.errors, [
        {
          path: ['updateBadAccess'],
          errors: [{ tag: 'BadAccess.access.operation.update', returned: 'object' }],
        },
      ]);

      // Item should have its original name
      const _items = await context.sudo().query.BadAccess.findMany({ query: 'id name' });
      expect(_items.map(({ name }) => name)).toEqual(['good']);
    })
  );

  test(
    'deleteOne - Bad function return value',
    runner(async ({ context, graphQLRequest }) => {
      const item = await context.sudo().query.BadAccess.createOne({ data: { name: 'good' } });

      // Valid name
      const { body } = await graphQLRequest({
        query: `mutation ($id: ID!) { deleteBadAccess(where: { id: $id }) { id } }`,
        variables: { id: item.id },
      });

      // Returns null and throws an error
      expect(body.data).toEqual({ deleteBadAccess: null });
      expectAccessReturnError(body.errors, [
        {
          path: ['deleteBadAccess'],
          errors: [{ tag: 'BadAccess.access.operation.delete', returned: 'object' }],
        },
      ]);

      // Item should have its original name
      const _items = await context.sudo().query.BadAccess.findMany({ query: 'id name' });
      expect(_items.map(({ name }) => name)).toEqual(['good']);
    })
  );
});
