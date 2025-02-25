import { describe, it, expect } from 'vitest';
import { schema } from '../../src/schema';
import { ContainerType } from '../../src/schema/container-types';

describe('Schema Types', () => {
  describe('schema function', () => {
    it('should create a root schema', () => {
      const testSchema = schema({
        name: schema.String(),
        age: schema.Number(),
      });

      expect(testSchema.type).toBe('schema');
      expect(testSchema.definition).toHaveProperty('name');
      expect(testSchema.definition).toHaveProperty('age');
      expect(testSchema.options).toEqual({});
      expect(testSchema.getContainerType()).toBe(ContainerType.Map);
    });

    it('should accept schema options', () => {
      const testSchema = schema(
        {
          name: schema.String(),
        },
        { description: 'A test schema' }
      );

      expect(testSchema.options).toEqual({ description: 'A test schema' });
    });
  });

  describe('primitive schema types', () => {
    it('should create a string schema', () => {
      const stringSchema = schema.String({ required: true });
      
      expect(stringSchema.type).toBe('string');
      expect(stringSchema.options).toEqual({ required: true });
      expect(stringSchema.getContainerType()).toBeNull();
    });

    it('should create a number schema', () => {
      const numberSchema = schema.Number({ defaultValue: 0 });
      
      expect(numberSchema.type).toBe('number');
      expect(numberSchema.options).toEqual({ defaultValue: 0 });
      expect(numberSchema.getContainerType()).toBeNull();
    });

    it('should create a boolean schema', () => {
      const booleanSchema = schema.Boolean({ defaultValue: false });
      
      expect(booleanSchema.type).toBe('boolean');
      expect(booleanSchema.options).toEqual({ defaultValue: false });
      expect(booleanSchema.getContainerType()).toBeNull();
    });

    it('should create an ignore schema', () => {
      const ignoreSchema = schema.Ignore();
      
      expect(ignoreSchema.type).toBe('ignore');
      expect(ignoreSchema.options).toEqual({});
      expect(ignoreSchema.getContainerType()).toBeNull();
    });
  });

  describe('container schema types', () => {
    it('should create a LoroMap schema', () => {
      const mapSchema = schema.LoroMap({
        name: schema.String(),
        age: schema.Number(),
      });
      
      expect(mapSchema.type).toBe('loro-map');
      expect(mapSchema.definition).toHaveProperty('name');
      expect(mapSchema.definition).toHaveProperty('age');
      expect(mapSchema.options).toEqual({});
      expect(mapSchema.getContainerType()).toBe(ContainerType.Map);
    });

    it('should create a LoroList schema', () => {
      const itemSchema = schema.String();
      const listSchema = schema.LoroList(itemSchema);
      
      expect(listSchema.type).toBe('loro-list');
      expect(listSchema.itemSchema).toBe(itemSchema);
      expect(listSchema.options).toEqual({});
      expect(listSchema.getContainerType()).toBe(ContainerType.List);
    });

    it('should create a LoroList schema with idSelector', () => {
      const itemSchema = schema.LoroMap({
        id: schema.String(),
        name: schema.String(),
      });
      
      const idSelector = (item: any) => item.id;
      const listSchema = schema.LoroList(itemSchema, idSelector);
      
      expect(listSchema.type).toBe('loro-list');
      expect(listSchema.itemSchema).toBe(itemSchema);
      expect(listSchema.idSelector).toBe(idSelector);
      expect(listSchema.options).toEqual({});
      expect(listSchema.getContainerType()).toBe(ContainerType.List);
    });

    it('should create a LoroText schema', () => {
      const textSchema = schema.LoroText();
      
      expect(textSchema.type).toBe('loro-text');
      expect(textSchema.options).toEqual({});
      expect(textSchema.getContainerType()).toBe(ContainerType.RichText);
    });
  });

  describe('complex schema structures', () => {
    it('should create nested schema structures', () => {
      const addressSchema = schema.LoroMap({
        street: schema.String(),
        city: schema.String(),
        zipCode: schema.String(),
      });

      const contactSchema = schema.LoroMap({
        email: schema.String(),
        phone: schema.String(),
      });

      const userSchema = schema({
        name: schema.String(),
        age: schema.Number(),
        address: addressSchema,
        contact: contactSchema,
        notes: schema.LoroText(),
      });

      expect(userSchema.type).toBe('schema');
      expect(userSchema.definition.name.type).toBe('string');
      expect(userSchema.definition.age.type).toBe('number');
      expect(userSchema.definition.address.type).toBe('loro-map');
      expect(userSchema.definition.contact.type).toBe('loro-map');
      expect(userSchema.definition.notes.type).toBe('loro-text');
      
      // Check nested structure
      expect(userSchema.definition.address.definition.street.type).toBe('string');
      expect(userSchema.definition.contact.definition.email.type).toBe('string');
    });

    it('should create schemas with lists of complex items', () => {
      const todoSchema = schema.LoroMap({
        id: schema.String(),
        text: schema.String(),
        completed: schema.Boolean(),
        tags: schema.LoroList(schema.String()),
      });

      const todosSchema = schema({
        todos: schema.LoroList(todoSchema),
        settings: schema.LoroMap({
          showCompleted: schema.Boolean(),
          sortBy: schema.String(),
        }),
      });

      expect(todosSchema.type).toBe('schema');
      expect(todosSchema.definition.todos.type).toBe('loro-list');
      expect(todosSchema.definition.todos.itemSchema.type).toBe('loro-map');
      expect(todosSchema.definition.todos.itemSchema.definition.tags.type).toBe('loro-list');
      expect(todosSchema.definition.todos.itemSchema.definition.tags.itemSchema.type).toBe('string');
      expect(todosSchema.definition.settings.type).toBe('loro-map');
      expect(todosSchema.definition.settings.definition.showCompleted.type).toBe('boolean');
    });
  });
}); 
