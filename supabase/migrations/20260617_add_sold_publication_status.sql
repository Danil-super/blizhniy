-- Ensure production accepts the listing status used by the cabinet "Продано / снять" action.

alter type publication_status add value if not exists 'sold';
