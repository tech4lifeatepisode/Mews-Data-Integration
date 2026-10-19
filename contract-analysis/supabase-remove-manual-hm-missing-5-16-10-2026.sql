-- Manual removals: Understory A/S, PB-1 guest, 3 test rows (16 Oct 2026)
delete from public."Final_Format_HouseMonk_15_10_2026" where id in (
  '1ec6f280-6ef6-4d58-8f2b-f1304ebe191b',
  '515fde06-784b-46b4-9ef4-8b2d7cc8a1fe',
  '5d409c39-d3e2-4ee0-9275-e86784a25713',
  'f202f78e-3fa4-4cc2-b182-4c7a6acc3dd2',
  '9fb34b0e-5098-40e0-8e8c-8e4899e55e71'
);

delete from public."Missing_Group_Code_HouseMonk_15_10_2026" where id in (
  '6ae17c8c-f56e-49c2-a6b8-8925a59b90b9',
  '8e92bf62-c6d7-44b8-82bd-3d4b11e3e8ba',
  '611a4ebe-393f-4210-aeea-4614697db6c7',
  '52bf7887-6011-4cda-88e4-57a06fde657d',
  'db9749e9-0191-4912-aaf7-43ff0b8245a7'
);
