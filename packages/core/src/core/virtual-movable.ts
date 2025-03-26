type ItemWithId = { id: string | number; item: any };
type ItemWithIndex = { index: number; item: any };
type ItemWithIdAndIndex = { id: string | number; index: number; item: any };

/** 
 * Virtual list is supposed to mimic the behavior of a Loro MovableList
 * Helps with figuring out the dynamic order of operations for moves when diffing state
 */
export class VirtualMovableList {
	private list: ItemWithId[];

	constructor(list: Map<string | number, ItemWithIndex> = new Map()) {
		this.list = Array.from(list.entries(), ([id, { item }]) => ({ id, item }));
	}

	getById(id: string | number): ItemWithIdAndIndex | undefined {
		const index = this.list.findIndex((item) => item.id === id);
		if (index === -1) {
			return undefined;
		}

		return { id, index, item: this.list[index].item };
	}

	move(fromIndex: number, toIndex: number) {
		if (fromIndex < 0 || fromIndex >= this.list.length) {
			throw new Error(
				`Failed to move item in virtual list, invalid fromIndex: ${fromIndex}`,
			);
		}

		if (toIndex < 0 || toIndex > this.list.length) {
			throw new Error(
				`Failed to move item in virtual list, invalid toIndex: ${toIndex}`,
			);
		}

		if (fromIndex === toIndex) return;

		const [element] = this.list.splice(fromIndex, 1);
		this.list.splice(toIndex, 0, element);
	}

	insert(index: number, item: ItemWithId) {
		if (index < 0) {
			throw new Error("Failed to insert into virtual list, invalid index");
		}

		this.list.splice(index, 0, item);
	}

	deleteByIndex(index: number, count: number = 1) {
		if (index < 0 || index >= this.list.length || count < 1) {
			throw new Error("Failed to delete from virtual list, invalid index");
		}

		count = Math.min(count, this.list.length - index);
		this.list.splice(index, count);
	}

	deleteById(id: string | number) {
		const index = this.list.findIndex((item) => item.id === id);
		if (index === -1) {
			throw new Error("Failed to delete from virtual list, invalid id");
		}

		this.deleteByIndex(index);
	}
}
