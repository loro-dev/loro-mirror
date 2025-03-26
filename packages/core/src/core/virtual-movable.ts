type ItemWithId = { id: string | number; [key: string]: any };
type ItemWithIndex = { index: number; item: any };

export class VirtualMovableList {
  private list: Array<ItemWithId>;

  constructor(list: Array<ItemWithId>) {
    this.list = [...list];
  }

  getById(id: string | number): ItemWithIndex | undefined {
    const index = this.list.findIndex((item) => item.id === id);
    if (index === -1) {
      return undefined;
    }
    return { index, item: this.list[index] };
  }

  get(index: number): ItemWithId | undefined {
    return index >= 0 && index < this.list.length ? this.list[index] : undefined;
  }

  delete(index: number): boolean {
    if (index < 0 || index >= this.list.length) {
      return false;
    }
    
    this.list = [...this.list.slice(0, index), ...this.list.slice(index + 1)];
    return true;
  }

  toArray(): Array<ItemWithId> {
    return [...this.list];
  }

  insert(index: number, value: ItemWithId): boolean {
    if (index < 0 || index > this.list.length) {
      return false;
    }
    
    this.list = [
      ...this.list.slice(0, index),
      value,
      ...this.list.slice(index)
    ];
    return true;
  }

  move(fromIndex: number, toIndex: number): boolean {
    if (
      fromIndex < 0 || 
      fromIndex >= this.list.length || 
      toIndex < 0 || 
      toIndex >= this.list.length
    ) {
      return false;
    }
    
    const item = this.list[fromIndex];
    
    if (fromIndex < toIndex) {
      this.list = [
        ...this.list.slice(0, fromIndex),
        ...this.list.slice(fromIndex + 1, toIndex + 1),
        item,
        ...this.list.slice(toIndex + 1)
      ];
    } else {
      this.list = [
        ...this.list.slice(0, toIndex),
        item,
        ...this.list.slice(toIndex, fromIndex),
        ...this.list.slice(fromIndex + 1)
      ];
    }
    
    return true;
  }
}
