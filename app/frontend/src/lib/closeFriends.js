const KEY = "nexus_close_friends";

export function getCloseFriends() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function setCloseFriends(ids) {
  localStorage.setItem(KEY, JSON.stringify(ids));
}

export function toggleCloseFriend(userId) {
  const list = getCloseFriends();
  const i = list.indexOf(userId);
  if (i >= 0) list.splice(i, 1);
  else list.push(userId);
  setCloseFriends(list);
  return list;
}

export function isCloseFriend(userId) {
  return getCloseFriends().includes(userId);
}
