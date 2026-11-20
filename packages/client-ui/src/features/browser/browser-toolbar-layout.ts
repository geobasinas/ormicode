export function browserToolbarOverflow(width: number) {
  return {
    device: width < 640,
    console: width < 590,
    draw: width < 540,
    pick: width < 490,
  };
}
