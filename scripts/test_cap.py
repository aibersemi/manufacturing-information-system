from test_flow_bisnis import get_session, get_my_operator_id

s = get_session("potong")
print("potong id:", get_my_operator_id(s))
