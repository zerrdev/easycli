export async function downCommand(groupName: string): Promise<number> {
  // Note: In single-process approach, down is only useful
  // if we add persistent state later
  console.log(`Command 'down ${groupName}' - group will stop when easycli exits`);
  return 0;
}
