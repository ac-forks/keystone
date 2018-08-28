const { Text, Relationship } = require('@keystonejs/fields');
const { resolveAllKeys, mapKeys } = require('@keystonejs/utils');
const { setupServer, graphqlRequest } = require('../../util');
const cuid = require('cuid');

let server;

function create(list, item) {
  // bypass the access control settings
  return server.keystone.getListByKey(list).adapter.create(item);
}

beforeAll(() => {
  server = setupServer({
    name: `ks5-testdb-${cuid()}`,
    createLists: keystone => {
      keystone.createList('User', {
        fields: {
          company: { type: Relationship, ref: 'Company' },
          posts: { type: Relationship, ref: 'Post', many: true },
        },
      });

      keystone.createList('Company', {
        fields: {
          name: { type: Text },
        },
      });

      keystone.createList('Post', {
        fields: {
          content: { type: Text },
        },
      });
    },
  });

  server.keystone.connect();
});

afterAll(async () => {
  // clean the db
  await resolveAllKeys(mapKeys(server.keystone.adapters, adapter => adapter.dropDatabase()));
  // then shut down
  await resolveAllKeys(
    mapKeys(server.keystone.adapters, adapter => adapter.dropDatabase().then(() => adapter.close()))
  );
});

beforeEach(() =>
  // clean the db
  resolveAllKeys(mapKeys(server.keystone.adapters, adapter => adapter.dropDatabase())));

// TODO: Test the case outlined in https://github.com/keystonejs/keystone-5/issues/224
describe('relationship filtering', () => {
  test('implicitly filters to only the IDs in the database by default', () => {});

  test('explicitly filters when given a `where` clause', () => {});

  test('nested to-single relationships can be filtered within AND clause', async () => {
    const company = await create('Company', { name: 'Thinkmill' });
    const otherCompany = await create('Company', { name: 'Cete' });

    const user = await create('User', { company: company.id });
    await create('User', { company: otherCompany.id });

    // NOTE: This will fail with current AND implementation
    const queryUser = await graphqlRequest({
      server,
      query: `
        query {
          allUsers(where: {
            AND: [
              { company: { name_contains: "in" } },
              { company: { name_contains: "ll" } }
            ]
          }) {
            id
            company {
              id
              name
            }
          }
        }
      `,
    });

    expect(queryUser.body).not.toHaveProperty('errors');
    expect(queryUser.body.data.allUsers).toHaveLength(1);
    expect(queryUser.body.data).toMatchObject({
      allUsers: [
        {
          id: user.id,
          company: {
            id: company.id,
            name: 'Thinkmill',
          },
        },
      ],
    });
  });

  test('nested to-many relationships can be filtered within AND clause', async () => {
    const ids = [];

    ids.push((await create('Post', { content: 'Hello world' })).id);
    ids.push((await create('Post', { content: 'hi world' })).id);
    ids.push((await create('Post', { content: 'Hello? Or hi?' })).id);

    const user = await create('User', { posts: ids });

    // Create a dummy user to make sure we're actually filtering it out
    await create('User', { posts: [] });

    // NOTE: This will fail with current AND implementation
    const queryUser = await graphqlRequest({
      server,
      query: `
        query {
          allUsers(where: {
            AND: [
              { posts_some: { content_contains: "hi" } },
              { posts_some: { content_contains: "lo" } }
            ]
          }) {
            id
            posts {
              id
              content
            }
          }
        }
      `,
    });

    expect(queryUser.body).not.toHaveProperty('errors');
    expect(queryUser.body.data).toHaveProperty('allUsers.0.posts');
    expect(queryUser.body.data.allUsers[0].posts).toHaveLength(3);
    expect(queryUser.body.data).toMatchObject({
      allUsers: [
        {
          id: user.id,
          posts: [{ id: ids[0] }, { id: ids[1] }, { id: ids[2] }],
        },
      ],
    });
  });
});
