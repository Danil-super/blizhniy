export function capitalizeFirstTextLetter(value: string) {
  const letterIndex = value.search(/\p{L}/u);

  if (letterIndex < 0) {
    return value;
  }

  const letter = value[letterIndex];

  return `${value.slice(0, letterIndex)}${letter.toLocaleUpperCase("ru-RU")}${value.slice(letterIndex + 1)}`;
}
