with open("backend/production/services.py", "r") as f:
    content = f.read()

# Add record_material_movement to imports
content = content.replace(
    "move_product_stock,\n    moving_average_cost,",
    "move_product_stock,\n    moving_average_cost,\n    record_material_movement,",
)

# Remove unused date
content = content.replace("    from datetime import date\n", "")

with open("backend/production/services.py", "w") as f:
    f.write(content)
